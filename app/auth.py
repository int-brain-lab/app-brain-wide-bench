"""Auth0 JWT validation and the ``get_current_user`` dependency.

The ``auth0_sub`` claim encodes the identity provider::

    google-oauth2|<id>   -> provider="google"
    windowslive|<id>     -> provider="microsoft"
    oauth2|orcid|<id>    -> provider="orcid", orcid_id=<id>

In dev mode (``AUTH0_DOMAIN=dev``) JWT verification is skipped and a single stub
user is upserted, so the API can be exercised locally without Auth0.
"""

import uuid

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models import TeamRole, UserTeam, User

_DEV_SUB = "dev|local-user"
_jwks_cache: dict | None = None


def parse_sub(auth0_sub: str) -> tuple[str, str | None]:
    """Map an ``auth0_sub`` claim to ``(provider, orcid_id)``.

    Parameters
    ----------
    auth0_sub : str
        The ``sub`` claim from the access token.

    Returns
    -------
    tuple[str, str | None]
        Provider label and, for ORCID logins, the ORCID iD.
    """
    if auth0_sub.startswith("google-oauth2|"):
        return "google", None
    if auth0_sub.startswith("windowslive|"):
        return "microsoft", None
    if auth0_sub.startswith("oauth2|orcid|"):
        return "orcid", auth0_sub.rsplit("|", 1)[-1]
    return "unknown", None


async def _fetch_jwks(*, force_refresh: bool = False) -> dict:
    """Fetch (and cache) the Auth0 tenant JWKS."""
    global _jwks_cache
    if _jwks_cache is None or force_refresh:
        url = f"https://{settings.auth0_domain}/.well-known/jwks.json"
        async with httpx.AsyncClient() as client:
            _jwks_cache = (await client.get(url)).json()
    return _jwks_cache


async def _decode_token(token: str) -> dict:
    """Verify an Auth0 RS256 access token and return its claims."""
    kid = jwt.get_unverified_header(token).get("kid")

    jwks = await _fetch_jwks()
    key = next((k for k in jwks["keys"] if k["kid"] == kid), None)
    if key is None:
        # Unrecognised kid may just mean Auth0 rotated its signing keys since we last
        # cached them — refetch once before rejecting a token that could be legitimate.
        jwks = await _fetch_jwks(force_refresh=True)
        key = next((k for k in jwks["keys"] if k["kid"] == kid), None)
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown signing key")
    try:
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.auth0_audience,
            issuer=f"https://{settings.auth0_domain}/",
        )
    except Exception as exc:  # jose raises a variety of JWTError subclasses
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc


async def _upsert_user(session: AsyncSession, claims: dict) -> User:
    """Insert or update the ``User`` row matching the token's ``sub``."""
    sub = claims["sub"]
    provider, orcid_id = parse_sub(sub)
    email = claims.get("email", "")
    user = (
        await session.execute(select(User).where(User.auth0_sub == sub))
    ).scalar_one_or_none()
    if user is None:
        # A new ``auth0_sub`` sharing an existing account's email is the same person
        # signing in through a second provider (e.g. Google, then ORCID) — a ``User``
        # row holds exactly one ``auth0_sub``, so there is no way to link the two
        # without minting a second, disconnected account (separate teams, separate
        # submissions). Refuse instead, and point them at the provider they already
        # used; not silently splitting one identity is worth the rare false positive
        # of two different people who happen to share an email.
        if email:
            existing = (
                await session.execute(
                    select(User).where(func.lower(User.email) == email.lower())
                )
            ).scalar_one_or_none()
            if existing is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"An account already exists for {email} via {existing.provider}. "
                    "Sign in with that provider instead.",
                )

        user = User(auth0_sub=sub, provider=provider, orcid_id=orcid_id)
        # Seeded once, from the provider, and never overwritten again: ``name`` is a
        # display name the user owns and can change via PATCH /api/users/me. Re-syncing
        # it on every request — as this used to — silently undid their edit on the very
        # next call. Nothing depends on it matching the provider; identity is
        # ``auth0_sub`` and the lookup key is ``email``.
        user.name = claims.get("name")
        session.add(user)

    # ``email`` does keep syncing. It is how a person is found and added to a team, so it
    # has to track the identity provider rather than drift from it.
    user.email = email or user.email or ""
    await session.commit()
    await session.refresh(user)
    return user


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    """FastAPI dependency that returns the authenticated :class:`User`.

    Validates the bearer token, parses the provider from ``sub``, and upserts the
    user. In dev mode a stub user is returned without any token.
    """
    if settings.dev_mode:
        claims = {"sub": _DEV_SUB, "email": "dev@brainwidebench.org", "name": "Dev User"}
        return await _upsert_user(session, claims)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    claims = await _decode_token(authorization.split(" ", 1)[1])
    return await _upsert_user(session, claims)


async def get_current_user_optional(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """Like :func:`get_current_user`, but returns ``None`` instead of a 401.

    For endpoints serving both anonymous and authenticated viewers — e.g. a
    public model card that shows private submissions to the model's own team
    only. In dev mode this still resolves to the stub user, matching
    :func:`get_current_user`; there is no unauthenticated request in dev mode.
    """
    if settings.dev_mode:
        return await get_current_user(authorization, session)
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        return await get_current_user(authorization, session)
    except HTTPException:
        return None


async def member_team_roles(
    user_id: uuid.UUID | None, session: AsyncSession
) -> dict[uuid.UUID, TeamRole]:
    """``user_id``'s role in each team they belong to, fetched in one query.

    The single definition of what team membership means, and now of what it grants:
    everything below is a thin wrapper over it, so a future ``accepted_at`` filter or a
    superuser bypass has exactly one place to be added rather than five.

    A team the user isn't in is simply absent, so callers use ``.get(team_id)``.
    """
    if user_id is None:
        return {}

    rows = await session.execute(
        select(UserTeam.team_id, UserTeam.role).where(UserTeam.user_id == user_id)
    )
    return dict(rows.all())


async def member_team_ids(user_id: uuid.UUID | None, session: AsyncSession) -> set[uuid.UUID]:
    """Team IDs ``user_id`` belongs to.

    The right call when scoping a whole listing — ``list_models`` uses it both in SQL
    (``Model.team_id.in_(...)``) and to classify each row, where a per-row membership
    check would be one round trip per model.
    """
    return set(await member_team_roles(user_id, session))


async def is_team_member(
    user_id: uuid.UUID | None, team_id: uuid.UUID, session: AsyncSession
) -> bool:
    """Whether ``user_id`` belongs to ``team_id``.

    For deciding what to *show* rather than whether to allow: it returns False for
    an anonymous caller instead of raising, which is what a public endpoint
    serving a scoped view needs (see ``_load_model_detail``).

    Note a non-existent team is also False, so a caller that relies on this alone
    will refuse a missing team rather than 404 it — look the resource up first if
    that distinction matters.
    """
    return team_id in await member_team_roles(user_id, session)


async def is_team_owner(
    user_id: uuid.UUID | None, team_id: uuid.UUID, session: AsyncSession
) -> bool:
    """Whether ``user_id`` owns ``team_id``.

    For deciding what to *show* — whether to offer the controls that manage a team's
    membership — as ``is_team_member`` is for deciding what to show a member.
    """
    return (await member_team_roles(user_id, session)).get(team_id) == TeamRole.owner


async def require_team_owner(
    user_id: uuid.UUID,
    team_id: uuid.UUID,
    session: AsyncSession,
    *,
    detail: str = "Only an owner of this team can do that",
) -> None:
    """Raise 403 unless ``user_id`` owns ``team_id``.

    The stricter sibling of ``require_team_member``. Membership decides what you may see
    and submit; ownership decides who else gets in — otherwise anyone admitted to a team
    could admit anyone else, or remove the person who admitted them.
    """
    if not await is_team_owner(user_id, team_id, session):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail)


async def require_team_member(
    user_id: uuid.UUID,
    team_id: uuid.UUID,
    session: AsyncSession,
    *,
    detail: str = "Not a member of this team",
) -> None:
    """Raise 403 unless ``user_id`` belongs to ``team_id``.

    An assertion, not a getter — it returns nothing. Its predecessor
    (``_get_team_or_403``) fetched the ``Team`` via a join, but all five call sites
    discarded it, so the row is no longer fetched at all.

    Pass ``detail`` where the generic message would be ambiguous — an endpoint
    touching two teams should say which one the caller was refused on.
    """
    if not await is_team_member(user_id, team_id, session):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail)
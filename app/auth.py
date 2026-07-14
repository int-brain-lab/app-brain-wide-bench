"""Auth0 JWT validation and the ``get_current_user`` dependency.

The ``auth0_sub`` claim encodes the identity provider::

    google-oauth2|<id>   -> provider="google"
    windowslive|<id>     -> provider="microsoft"
    oauth2|orcid|<id>    -> provider="orcid", orcid_id=<id>

In dev mode (``AUTH0_DOMAIN=dev``) JWT verification is skipped and a single stub
user is upserted, so the API can be exercised locally without Auth0.
"""

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models import User

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


async def _fetch_jwks() -> dict:
    """Fetch (and cache) the Auth0 tenant JWKS."""
    global _jwks_cache
    if _jwks_cache is None:
        url = f"https://{settings.auth0_domain}/.well-known/jwks.json"
        async with httpx.AsyncClient() as client:
            _jwks_cache = (await client.get(url)).json()
    return _jwks_cache


async def _decode_token(token: str) -> dict:
    """Verify an Auth0 RS256 access token and return its claims."""
    jwks = await _fetch_jwks()
    header = jwt.get_unverified_header(token)
    key = next((k for k in jwks["keys"] if k["kid"] == header.get("kid")), None)
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
    user = (
        await session.execute(select(User).where(User.auth0_sub == sub))
    ).scalar_one_or_none()
    if user is None:
        user = User(auth0_sub=sub, provider=provider, orcid_id=orcid_id)
        session.add(user)
    user.email = claims.get("email", user.email or "")
    user.name = claims.get("name", user.name)
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

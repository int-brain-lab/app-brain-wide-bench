"""Tests for the auth0_sub -> User upsert logic in app.auth."""

import pytest
from fastapi import HTTPException

from app.auth import _upsert_user, parse_sub


def test_parse_sub_recognises_known_providers():
    assert parse_sub("google-oauth2|1") == ("google", None)
    assert parse_sub("windowslive|1") == ("microsoft", None)
    assert parse_sub("oauth2|orcid|0000-0001-2345-6789") == ("orcid", "0000-0001-2345-6789")
    assert parse_sub("auth0|1") == ("unknown", None)


async def test_upsert_user_is_idempotent_for_the_same_sub(session_factory):
    """Signing in twice through the same provider updates one row, not two."""
    claims = {"sub": "google-oauth2|1", "email": "alice@example.org", "name": "Alice"}

    async with session_factory() as session:
        first = await _upsert_user(session, claims)
    async with session_factory() as session:
        second = await _upsert_user(session, claims)

    assert first.id == second.id


async def test_upsert_user_refuses_a_second_provider_with_the_same_email(session_factory):
    """A new auth0_sub can't silently mint a second account for an existing email.

    A ``User`` row holds exactly one ``auth0_sub``, so there is no way to link a second
    login method to it without a schema change. Refusing the second sign-in keeps one
    person's teams and submissions on a single account instead of splitting them across
    two, and tells them which provider to use instead.
    """
    google = {"sub": "google-oauth2|1", "email": "alice@example.org", "name": "Alice"}
    orcid = {"sub": "oauth2|orcid|0000-0001-2345-6789", "email": "alice@example.org", "name": "Alice"}

    async with session_factory() as session:
        await _upsert_user(session, google)

    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc_info:
            await _upsert_user(session, orcid)

    assert exc_info.value.status_code == 409
    assert "google" in exc_info.value.detail


async def test_upsert_user_allows_an_empty_email_to_coexist(session_factory):
    """Two different accounts with no email claim (e.g. ORCID without the scope) don't
    collide with each other."""
    first_claims = {"sub": "oauth2|orcid|0000-0001-1111-1111", "email": "", "name": "No Email One"}
    second_claims = {"sub": "oauth2|orcid|0000-0002-2222-2222", "email": "", "name": "No Email Two"}

    async with session_factory() as session:
        first = await _upsert_user(session, first_claims)
    async with session_factory() as session:
        second = await _upsert_user(session, second_claims)

    assert first.id != second.id

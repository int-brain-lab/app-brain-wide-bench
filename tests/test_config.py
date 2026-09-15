"""Tests for the settings-level guards in app.config."""

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_wildcard_cors_is_fine_in_dev_mode():
    Settings(auth0_domain="dev", cors_origins="*")


def test_wildcard_cors_is_refused_against_a_real_tenant():
    """CORSMiddleware runs with allow_credentials=True, and Starlette reflects the caller's
    Origin instead of sending a literal `*` in that combination — so a wildcard here would
    silently mean "every origin, with credentials"."""
    with pytest.raises(ValidationError, match="CORS_ORIGINS=\\*"):
        Settings(auth0_domain="brainwidebench.us.auth0.com", cors_origins="*")


def test_pinned_cors_is_fine_against_a_real_tenant():
    Settings(
        auth0_domain="brainwidebench.us.auth0.com",
        cors_origins="https://brainwidebench.iblcore.org",
    )

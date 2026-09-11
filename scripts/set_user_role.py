"""Set a user's application role, or list the current admins.

`admin` passes every team membership and ownership check in the API: it reads and writes
every team's models, submissions and member list, and sees the fields withheld from
outsiders (`narrative_private`, `s3_key`, a team's member list).

    export DATABASE_URL="postgresql+psycopg://brainwidebench:changeme@localhost:5434/brainwidebench"
    python scripts/set_user_role.py --list
    python scripts/set_user_role.py mayo.faulkner@internationalbrainlab.org admin
    python scripts/set_user_role.py someone@lab.org user          # demote

There is deliberately no API path to this. `PATCH /api/users/me` forbids unknown fields, so
a role can only be granted by someone with database access — an access token, however it was
obtained, can never escalate itself.

Matches on email case-insensitively, the way the add-member endpoint looks a user up. An
unknown email is an error rather than a new row: promotion should never be how a user first
comes to exist, or a typo would mint an admin nobody can sign in as.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select

from app.database import async_session_factory
from app.models import User, UserRole


async def list_admins() -> int:
    """Print every user holding the admin role."""
    async with async_session_factory() as session:
        admins = (
            (
                await session.execute(
                    select(User).where(User.role == UserRole.admin).order_by(User.email)
                )
            )
            .scalars()
            .all()
        )

    for user in admins:
        print(f"admin    {user.email}  ({user.name or 'no name'})")

    print(f"\n{len(admins)} admin(s).")

    return 0


async def set_role(email: str, role: UserRole) -> int:
    """Set ``email``'s role, returning a process exit code."""
    async with async_session_factory() as session:
        user = (
            await session.execute(select(User).where(func.lower(User.email) == email.lower()))
        ).scalar_one_or_none()

        if user is None:
            print(f"no user with email {email}", file=sys.stderr)
            print("They must sign in once first, or be created by seed_test_users.py.", file=sys.stderr)
            return 1

        if user.role is role:
            print(f"unchanged  {user.email}  already {role.value}")
            return 0

        was = user.role.value
        user.role = role
        await session.commit()

    print(f"updated  {email}  {was} -> {role.value}")

    return 0


def usage() -> int:
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    args = sys.argv[1:]

    if args == ["--list"]:
        raise SystemExit(asyncio.run(list_admins()))

    if len(args) != 2 or args[1] not in {r.value for r in UserRole}:
        raise SystemExit(usage())

    raise SystemExit(asyncio.run(set_role(args[0], UserRole(args[1]))))

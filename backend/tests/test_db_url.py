from app.db.session import async_database_url


def test_neon_url_is_asyncpg_compatible():
    url, connect_args = async_database_url(
        "postgresql://u:p@ep-cool-name-123.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    )
    assert url.drivername == "postgresql+asyncpg"
    assert dict(url.query) == {}
    assert connect_args == {"ssl": "require"}


def test_prisma_url_params_are_dropped():
    url, connect_args = async_database_url("postgresql://u:p@db:5432/app?schema=public&connection_limit=5")
    assert dict(url.query) == {} and connect_args == {}

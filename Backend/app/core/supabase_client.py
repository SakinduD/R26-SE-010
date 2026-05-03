"""
Supabase client singletons.

Use get_supabase_client()       for user-context operations (reads, profile updates).
Use get_supabase_admin_client() for server-side admin operations that bypass RLS,
such as creating users from the backend during signup. The service-role key must
NEVER leave the server — do not return it in any API response.
"""
from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """Return a cached Supabase client using the public anon key."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_anon_key)


@lru_cache(maxsize=1)
def get_supabase_admin_client() -> Client:
    """Return a cached Supabase client using the service-role key (server-side only)."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)

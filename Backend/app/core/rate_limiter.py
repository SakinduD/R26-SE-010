"""
Minimal in-process rate limiter.

In-memory only — counters reset on restart and are not shared across worker
processes. That's fine for this app's current single-process deployment.
"""
import threading
import time
from collections import defaultdict, deque


class InMemoryRateLimiter:
    """Sliding-window rate limiter keyed by an arbitrary string (e.g. a user id)."""

    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, float]:
        """
        Records a hit for `key` if under the limit.
        Returns (allowed, retry_after_seconds) — retry_after is 0.0 when allowed.
        """
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            cutoff = now - self.window_seconds

            while hits and hits[0] < cutoff:
                hits.popleft()

            if len(hits) >= self.max_requests:
                retry_after = self.window_seconds - (now - hits[0])
                return False, max(retry_after, 0.0)

            hits.append(now)
            return True, 0.0

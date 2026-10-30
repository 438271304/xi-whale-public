"""Offline policy prototype. Not yet connected to Coopanion or any account."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

SHANGHAI = timezone(timedelta(hours=8))

def may_wake(at: datetime, *, event: str, authorized: bool) -> bool:
    if at.tzinfo is None:
        raise ValueError('Timezone-aware time required')
    if not authorized:
        return False
    if event not in {'direct_call', 'group_message', 'heartbeat', 'alarm', 'exploration'}:
        return False
    resting = at.astimezone(SHANGHAI).hour < 7
    return not resting or event == 'direct_call'

def affordable(*, spent: str, reserved: str, request_upper_bound: str, cap: str = '10') -> bool:
    values = [Decimal(x) for x in (spent, reserved, request_upper_bound, cap)]
    if any(not x.is_finite() or x < 0 for x in values):
        raise ValueError('Finite nonnegative amounts required')
    used, pending, request, maximum = values
    return used + pending + request <= maximum

def visible_memory(*, scope: str, conversation: str) -> bool:
    # Only deliberately public identity crosses conversation boundaries.
    return scope == 'public_identity' or (bool(conversation) and scope == conversation)

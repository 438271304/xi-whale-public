import unittest
from datetime import datetime
from guard import may_wake, affordable, visible_memory

class GuardTests(unittest.TestCase):
    def test_midnight_and_seven_boundaries(self):
        for clock, expected in [('23:59', True), ('00:00', False), ('06:59', False), ('07:00', True)]:
            at = datetime.fromisoformat('2026-10-23T' + clock + ':00+08:00')
            self.assertEqual(may_wake(at, event='heartbeat', authorized=True), expected)
    def test_alarm_cannot_bypass_rest(self):
        at = datetime.fromisoformat('2026-10-23T01:00:00+08:00')
        self.assertFalse(may_wake(at, event='alarm', authorized=True))
        self.assertTrue(may_wake(at, event='direct_call', authorized=True))
        self.assertFalse(may_wake(at, event='direct_call', authorized=False))
    def test_pending_cost_is_reserved(self):
        self.assertFalse(affordable(spent='8', reserved='1.5', request_upper_bound='0.6'))
        self.assertTrue(affordable(spent='8', reserved='1.5', request_upper_bound='0.5'))
        with self.assertRaises(ValueError):
            affordable(spent='NaN', reserved='0', request_upper_bound='1')
    def test_family_memory_not_visible_to_friends(self):
        self.assertFalse(visible_memory(scope='family', conversation='friends'))
        self.assertTrue(visible_memory(scope='family', conversation='family'))
        self.assertTrue(visible_memory(scope='public_identity', conversation='friends'))

if __name__ == '__main__':
    unittest.main()

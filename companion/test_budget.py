from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import unittest
from budget import Budget

class BudgetTests(unittest.TestCase):
    def test_two_connections_no_double_spend_and_restart(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'budget.db'; a=Budget(p); b=Budget(p)
            now=datetime.fromisoformat('2026-10-23T23:59:00+08:00')
            self.assertTrue(a.reserve('one',6,10,now))
            self.assertFalse(b.reserve('two',6,10,now))
            a.close(); a=Budget(p)
            self.assertFalse(a.reserve('one',6,10,now))
            self.assertFalse(a.reserve('tomorrow',6,10,now+timedelta(days=1)))
            a.settle('one',4)
            self.assertTrue(b.reserve('two',6,10,now))
            a.close(); b.close()
    def test_settlement_conflict_and_overspend_visible(self):
        b=Budget(':memory:'); now=datetime.now().astimezone()
        b.reserve('one',6,10,now)
        self.assertTrue(b.settle('one',11)['over_reserved'])
        self.assertFalse(b.reserve('two',1,10,now))
        with self.assertRaises(ValueError): b.settle('one',0)
        b.close()

if __name__=='__main__': unittest.main()

"""Durable offline spending reservations, integer micro-CNY. Not yet wired to API."""
import sqlite3
from datetime import datetime
from guard import SHANGHAI

class Budget:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None, timeout=10)
        self.db.execute('CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, day TEXT NOT NULL, reserved INTEGER NOT NULL, actual INTEGER, state TEXT NOT NULL)')

    def reserve(self, request_id, amount, cap, at):
        if not request_id or not isinstance(amount, int) or not isinstance(cap, int) or amount <= 0 or cap <= 0 or at.tzinfo is None:
            raise ValueError('Explicit ID, positive integer amounts and zoned time required')
        day = at.astimezone(SHANGHAI).date().isoformat()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            # Reusing an ID never grants a second outbound request.
            if self.db.execute('SELECT 1 FROM calls WHERE id=?', (request_id,)).fetchone():
                self.db.execute('ROLLBACK')
                return False
            # Unsettled requests from older days remain reserved conservatively.
            total = self.db.execute("SELECT COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE actual END),0) FROM calls WHERE state='pending' OR day=?", (day,)).fetchone()[0]
            if total + amount > cap:
                self.db.execute('ROLLBACK')
                return False
            self.db.execute("INSERT INTO calls VALUES (?,?,?,NULL,'pending')", (request_id, day, amount))
            self.db.execute('COMMIT')
            return True
        except BaseException:
            if self.db.in_transaction: self.db.execute('ROLLBACK')
            raise

    def settle(self, request_id, actual):
        if not isinstance(actual, int) or actual < 0:
            raise ValueError('Nonnegative actual amount required')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row = self.db.execute('SELECT reserved,actual,state FROM calls WHERE id=?', (request_id,)).fetchone()
            if row is None: raise ValueError('Unknown reservation')
            if row[2] != 'pending':
                if row[1] != actual: raise ValueError('Conflicting settlement')
            else:
                self.db.execute("UPDATE calls SET actual=?,state='settled' WHERE id=?", (actual,request_id))
            self.db.execute('COMMIT')
            return {'over_reserved': actual > row[0]}
        except BaseException:
            if self.db.in_transaction: self.db.execute('ROLLBACK')
            raise

    def close(self): self.db.close()

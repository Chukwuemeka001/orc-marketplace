"""Owner-held acceptance for the tradelog example. Env: ORC_REPO (default ~/orc-examples/tradelog), ORC_FINAL.
Expected values are computed by hand from MISSION.md / AMENDMENT.md, not from any implementation."""
import csv, json, os, subprocess, sys, tempfile, time, unittest

REPO = os.path.expanduser(os.environ.get('ORC_REPO', '~/orc-examples/tradelog'))
FINAL = os.path.expanduser(os.environ.get('ORC_FINAL', os.path.join(REPO, 'ops', 'FINAL.md')))
PY = sys.executable

# Columns deliberately out of the documented order ("columns in any order").
NATIVE = """setup,id,symbol,side,entry_time,exit_time,entry,exit,stop,qty,fees
breakout,t1,EURUSD,long,2026-03-02T09:00,2026-03-02T11:30,1.0800,1.0860,1.0770,10000,2
breakout,t2,GBPUSD,short,2026-03-03T08:00,2026-03-03T10:00:59,1.2700,1.2730,1.2720,10000,2
pullback,t3,XAUUSD,long,2026-03-04T14:00,2026-03-05T09:00,2300,2290,2290,1,0.5
pullback,t4,EURUSD,long,2026-03-06T10:00,2026-03-06T12:00,1.0850,1.0850,1.0830,10000,0
reversal,t5,NAS100,short,2026-03-09T15:00,2026-03-09T16:00,18000,17900,18050,2,4
breakout,t6,GBPUSD,long,2026-03-10T09:00,2026-03-11T09:00,1.2600,1.2570,1.2580,10000,2
"""
INVALID = """id,symbol,side,entry_time,exit_time,entry,exit,stop,qty,setup,fees
v1,EURUSD,long,2026-03-02T09:00,2026-03-02T11:30,1.08,1.086,1.077,10000,x,2
v2,EURUSD,flat,2026-03-02T09:00,2026-03-02T11:30,1.08,1.086,1.077,10000,x,2
v3,EURUSD,long,2026-03-02T09:00,2026-03-02T11:30,1.08,1.086,1.09,10000,x,2
"""
MT5 = """Ticket,Open Time,Type,Volume,Symbol,Open Price,S / L,Close Time,Close Price,Commission,Swap,Profit
1001,2026.04.01 08:00:00,buy,0.5,EURUSD,1.1000,1.0950,2026.04.01 12:30:15,1.1080,-3.5,-0.5,400
1002,2026.04.02 09:00:00,sell,1,XAUUSD,2400,2410,2026.04.02 10:00:00,2380,-7,1.0,2000
"""
MT5_BAD = """Ticket,Open Time,Type,Volume,Symbol,Open Price,S / L,Close Time,Close Price,Commission,Swap,Profit
2001,2026.04.01 08:00:00,buy,0.5,EURUSD,1.1000,0,2026.04.01 12:30:15,1.1080,-3.5,-0.5,400
"""
TAGGED = """id,symbol,side,entry_time,exit_time,entry,exit,stop,qty,setup,fees,tags
g1,EURUSD,long,2026-05-04T09:00,2026-05-04T10:00,1.10,1.11,1.09,1000,a,0,london;trend
g2,EURUSD,short,2026-05-05T09:00,2026-05-05T10:00,1.10,1.12,1.11,1000,a,0,london
g3,EURUSD,long,2026-05-06T09:00,2026-05-06T10:00,1.10,1.13,1.09,1000,b,0,
"""

# Hand-computed for NATIVE (order t1..t6 by exit time):
# pnl 58, -32, -10.5, 0, 196, -32; R 2, -1.5, -1, 0, 2, -1.5; cum 58, 26, 15.5, 15.5, 211.5, 179.5
ALL = {'trades': 6, 'wins': 2, 'losses': 3, 'win_rate': 2 / 6, 'avg_r': 0.0, 'expectancy': 179.5 / 6,
       'total_pnl': 179.5, 'profit_factor': 254 / 74.5, 'max_drawdown': 42.5, 'longest_losing_streak': 2}


def run(*args, timeout=120):
    p = subprocess.run([PY, '-m', 'tradelog', *args], cwd=REPO, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


class Hidden(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='tl-hidden-')
        self.db = os.path.join(self.tmp, 'db.json')
        self.csv = self.write('native.csv', NATIVE)

    def write(self, name, text):
        p = os.path.join(self.tmp, name)
        with open(p, 'w') as f: f.write(text)
        return p

    def imported(self, path=None, db=None, *extra):
        code, out, err = run('import', path or self.csv, '--db', db or self.db, *extra)
        self.assertEqual(code, 0, err)
        return out.strip()

    def stats(self, *extra, db=None):
        code, out, err = run('stats', '--db', db or self.db, '--json', *extra)
        self.assertEqual(code, 0, err)
        return json.loads(out)

    def assertStats(self, got, want):
        for k, v in want.items():
            if v is None or isinstance(v, int) and not isinstance(v, bool) and k in ('trades', 'wins', 'losses', 'longest_losing_streak'):
                self.assertEqual(got[k], v, k)
            else:
                self.assertAlmostEqual(got[k], v, places=6, msg=k)

    def test_01_repo_tests_pass(self):
        p = subprocess.run([PY, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=REPO, capture_output=True, text=True, timeout=900)
        self.assertEqual(p.returncode, 0, p.stderr[-1500:])

    def test_02_import_and_duplicates(self):
        self.assertEqual(self.imported(), 'imported 6, skipped 0')
        self.assertEqual(self.imported(), 'imported 0, skipped 6')

    def test_03_invalid_csv_writes_nothing(self):
        bad = self.write('bad.csv', INVALID)
        code, out, err = run('import', bad, '--db', self.db)
        self.assertEqual(code, 4)
        self.assertIn('line 3', err); self.assertIn('line 4', err); self.assertNotIn('line 2', err)
        self.assertFalse(os.path.exists(self.db), 'nothing may be written when a row is invalid')

    def test_04_stats_all(self):
        self.imported()
        self.assertStats(self.stats(), ALL)
        code, out, _ = run('stats', '--db', self.db); self.assertEqual(code, 0); self.assertIn('trades', out)

    def test_05_stats_by(self):
        self.imported()
        d = self.stats('--by', 'setup'); self.assertEqual(d['by'], 'setup')
        g = d['groups']; self.assertEqual(set(g), {'breakout', 'pullback', 'reversal'})
        self.assertStats(g['breakout'], {'trades': 3, 'wins': 1, 'losses': 2, 'total_pnl': -6.0, 'profit_factor': 58 / 64, 'max_drawdown': 64.0, 'longest_losing_streak': 2})
        self.assertStats(g['pullback'], {'trades': 2, 'wins': 0, 'losses': 1, 'total_pnl': -10.5, 'profit_factor': 0.0, 'max_drawdown': 10.5})
        self.assertStats(g['reversal'], {'trades': 1, 'wins': 1, 'losses': 0, 'profit_factor': None, 'max_drawdown': 0.0, 'longest_losing_streak': 0})
        w = self.stats('--by', 'weekday')['groups']
        self.assertEqual({k: v['trades'] for k, v in w.items()}, {'Mon': 2, 'Tue': 1, 'Thu': 1, 'Fri': 1, 'Wed': 1})
        self.assertEqual(set(self.stats('--by', 'month')['groups']), {'2026-03'})
        self.assertEqual(run('stats', '--db', self.db, '--by', 'colour')[0], 2)

    def test_06_date_filter_and_empty(self):
        self.imported()
        self.assertStats(self.stats('--from', '2026-03-05', '--to', '2026-03-09'), {'trades': 3, 'wins': 1, 'losses': 1, 'total_pnl': 185.5})
        empty = self.stats('--from', '2027-01-01')
        self.assertStats(empty, {'trades': 0, 'wins': 0, 'losses': 0, 'total_pnl': 0.0, 'max_drawdown': 0.0, 'win_rate': None, 'avg_r': None, 'expectancy': None, 'profit_factor': None})

    def test_07_equity_and_daily(self):
        self.imported()
        out = os.path.join(self.tmp, 'eq.csv')
        code, _, err = run('equity', '--db', self.db, '--out', out); self.assertEqual(code, 0, err)
        rows = list(csv.reader(open(out)))
        self.assertEqual(rows[0], ['exit_time', 'id', 'pnl', 'cum_pnl', 'drawdown'])
        self.assertEqual([r[1] for r in rows[1:]], ['t1', 't2', 't3', 't4', 't5', 't6'])
        self.assertEqual(rows[2][0], '2026-03-03T10:00', 'seconds are dropped')
        self.assertEqual(rows[3][2:], ['-10.50', '15.50', '42.50'])
        code, out, err = run('daily', '--db', self.db, '--json'); self.assertEqual(code, 0, err)
        d = json.loads(out); self.assertEqual([x['date'] for x in d][:2], ['2026-03-02', '2026-03-03'])
        self.assertAlmostEqual(d[-1]['cum_pnl'], 179.5, places=6); self.assertEqual(d[4]['trades'], 1)

    def test_08_size(self):
        code, out, err = run('size', '--balance', '10000', '--risk-pct', '1', '--entry', '1.0800', '--stop', '1.0770', '--step', '1000')
        self.assertEqual(code, 0, err); d = json.loads(out)
        self.assertAlmostEqual(d['units'], 33000, places=6); self.assertAlmostEqual(d['risk'], 100, places=6); self.assertAlmostEqual(d['risk_per_unit'], 0.003, places=9)
        code, out, _ = run('size', '--balance', '5000', '--risk-pct', '2', '--entry', '2300', '--stop', '2290')
        self.assertEqual(code, 0); self.assertAlmostEqual(json.loads(out)['units'], 10, places=6)
        self.assertEqual(run('size', '--balance', '5000', '--risk-pct', '2', '--entry', '2300', '--stop', '2300')[0], 2)
        self.assertEqual(run('size', '--balance', '5000', '--risk-pct', '0', '--entry', '2300', '--stop', '2290')[0], 2)

    def test_09_report(self):
        self.imported()
        out = os.path.join(self.tmp, 'r.md')
        code, _, err = run('report', '--db', self.db, '--out', out); self.assertEqual(code, 0, err)
        text = open(out).read()
        for s in ('# Trade report', '## Summary', '## By setup', 'breakout', 'pullback', 'reversal', '179.50'): self.assertIn(s, text)

    def test_10_exit_codes(self):
        self.assertEqual(run()[0], 2)
        self.assertEqual(run('bogus')[0], 2)
        self.assertEqual(run('stats', '--db', os.path.join(self.tmp, 'none.json'))[0], 3)
        self.assertEqual(run('import', os.path.join(self.tmp, 'none.csv'), '--db', self.db)[0], 3)

    def test_11_mt5(self):
        self.assertEqual(self.imported(self.write('mt5.csv', MT5), None, '--format', 'mt5'), 'imported 2, skipped 0')
        g = self.stats('--by', 'setup')['groups']['mt5']
        self.assertStats(g, {'trades': 2, 'wins': 1, 'losses': 1, 'avg_r': 1.8, 'total_pnl': 10.004})
        out = os.path.join(self.tmp, 'eq.csv'); run('equity', '--db', self.db, '--out', out)
        rows = list(csv.reader(open(out))); self.assertEqual(rows[1][:2], ['2026-04-01T12:30', 'mt5-1001'])
        db2 = os.path.join(self.tmp, 'db2.json')
        code, _, err = run('import', self.write('mt5bad.csv', MT5_BAD), '--format', 'mt5', '--db', db2)
        self.assertEqual(code, 4); self.assertIn('line 2', err)

    def test_12_perf_200k(self):
        big = os.path.join(self.tmp, 'big.csv')
        with open(big, 'w') as f:
            f.write('id,symbol,side,entry_time,exit_time,entry,exit,stop,qty,setup,fees\n')
            for i in range(200000):
                day = 1 + i % 28; side = 'long' if i % 2 else 'short'
                stop = '99' if side == 'long' else '101'
                f.write(f'p{i},SYM{i % 7},{side},2026-02-{day:02d}T09:00,2026-02-{day:02d}T10:{i % 60:02d},100,{100 + (i % 5) - 2},{stop},1,s{i % 3},0\n')
        code, _, err = run('import', big, '--db', self.db, timeout=600); self.assertEqual(code, 0, err)
        try: load = float(subprocess.run(['/usr/sbin/sysctl', '-n', 'vm.loadavg'], capture_output=True, text=True).stdout.split()[1]); cores = int(subprocess.run(['/usr/sbin/sysctl', '-n', 'hw.ncpu'], capture_output=True, text=True).stdout)
        except Exception: load, cores = 0.0, 1
        t0 = time.time(); code, out, err = run('stats', '--db', self.db, '--json', timeout=300); dt = time.time() - t0
        self.assertEqual(code, 0, err); self.assertEqual(json.loads(out)['trades'], 200000)
        if load <= cores: self.assertLess(dt, 5.0, f'{dt:.1f}s (load {load} on {cores} cores)')

    def test_13_amendment_tags_and_stats(self):
        self.imported(self.write('tagged.csv', TAGGED))
        self.assertStats(self.stats('--tag', 'london'), {'trades': 2, 'total_pnl': -10.0})
        g = self.stats('--by', 'tag')['groups']
        self.assertEqual({k: v['trades'] for k, v in g.items()}, {'london': 2, 'trend': 1, 'untagged': 1})
        s = self.stats()
        self.assertAlmostEqual(s['avg_win_r'], 2.0, places=6); self.assertAlmostEqual(s['avg_loss_r'], -2.0, places=6)
        self.assertAlmostEqual(s['sharpe_r'], (2 / 3) / (19 / 3) ** 0.5, places=6)
        self.assertIsNone(self.stats('--tag', 'trend')['sharpe_r'])

    def test_14_amendment_export_round_trip(self):
        self.imported(); self.imported(self.write('tagged.csv', TAGGED))
        exp = os.path.join(self.tmp, 'exp.csv')
        code, _, err = run('export', '--db', self.db, '--out', exp); self.assertEqual(code, 0, err)
        db2 = os.path.join(self.tmp, 'db2.json'); self.imported(exp, db2)
        self.assertEqual(run('stats', '--db', self.db, '--json')[1], run('stats', '--db', db2, '--json')[1])
        e1, e2 = os.path.join(self.tmp, 'e1.csv'), os.path.join(self.tmp, 'e2.csv')
        run('equity', '--db', self.db, '--out', e1); run('equity', '--db', db2, '--out', e2)
        self.assertEqual(open(e1).read(), open(e2).read())
        self.assertEqual(self.stats('--by', 'tag', db=db2)['groups']['london']['trades'], 2)

    def test_15_readme_and_final(self):
        r = open(os.path.join(REPO, 'README.md')).read().lower()
        for w in ('mt5', 'exit', 'gap', 'expectancy'): self.assertIn(w, r)
        self.assertTrue(os.path.exists(FINAL), FINAL)
        self.assertRegex(open(FINAL).read(), r'(?m)^STATUS:')


if __name__ == '__main__':
    unittest.main()

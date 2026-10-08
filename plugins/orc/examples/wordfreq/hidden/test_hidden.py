"""Owner-held acceptance for the wordfreq example. Env: WF_REPO (default ~/orc-examples/wordfreq), WF_FINAL."""
import json, os, subprocess, sys, tempfile, time, unittest

REPO = os.path.expanduser(os.environ.get('WF_REPO', '~/orc-examples/wordfreq'))
FINAL = os.path.expanduser(os.environ.get('WF_FINAL', os.path.join(REPO, 'ops', 'FINAL.md')))
PY = sys.executable
TEXT = "The cat's hat. The HAT, the cat! 42 cats; don't stop: the end.\n"


def run(*args, timeout=60):
    p = subprocess.run([PY, '-m', 'wordfreq', *args], cwd=REPO, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


class Hidden(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='wf-hidden-')
        self.f = os.path.join(self.tmp, 'a.txt'); open(self.f, 'w').write(TEXT)

    def test_01_repo_tests_pass(self):
        p = subprocess.run([PY, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=REPO, capture_output=True, text=True, timeout=600)
        self.assertEqual(p.returncode, 0, p.stderr[-1500:])

    def test_02_count_text_and_json(self):
        code, out, err = run('count', self.f); self.assertEqual(code, 0, err)
        first = out.splitlines()[0].split('\t'); self.assertEqual(first, ['the', '4'])
        code, out, err = run('count', self.f, '--json'); self.assertEqual(code, 0, err)
        d = json.loads(out); self.assertEqual(d['files'], 1); self.assertEqual(d['top'][0], ['the', 4])
        self.assertIn(["cat's", 1], d['top']); self.assertIn(['42', 1], d['top'])

    def test_03_min_len_and_exit_codes(self):
        code, out, _ = run('count', self.f, '--json', '--min-len', '4'); self.assertEqual(code, 0)
        self.assertTrue(all(len(w) >= 4 for w, _ in json.loads(out)['top']))
        self.assertEqual(run()[0], 2); self.assertEqual(run('count', self.f, '--bogus')[0], 2); self.assertEqual(run('count', self.f, '--min-len', 'x')[0], 2)
        self.assertEqual(run('count', os.path.join(self.tmp, 'missing.txt'))[0], 3)
        empty = os.path.join(self.tmp, 'e.txt'); open(empty, 'w').write('... !!! \n'); self.assertEqual(run('count', empty)[0], 3)

    def test_04_compare(self):
        g = os.path.join(self.tmp, 'b.txt'); open(g, 'w').write("cat cat cat the hat\n")
        code, out, err = run('compare', self.f, g, '--json'); self.assertEqual(code, 0, err)
        d = json.loads(out); self.assertEqual(d['a'], self.f); self.assertTrue(any(m[0] == 'cat' for m in d['moved']))

    def test_05_perf_10mb(self):
        big = os.path.join(self.tmp, 'big.txt')
        with open(big, 'w') as f:
            for _ in range(10 * 1024 * 1024 // len(TEXT)): f.write(TEXT)
        t0 = time.time(); code, out, err = run('count', big, '--json', timeout=120); dt = time.time() - t0
        self.assertEqual(code, 0, err); self.assertLess(dt, 5.0, f'{dt:.1f}s')

    def test_06_amendment(self):
        sw = os.path.join(self.tmp, 'stop.txt'); open(sw, 'w').write('the\nTHE\n')
        code, out, err = run('count', self.f, '--json', '--stopwords', sw); self.assertEqual(code, 0, err)
        self.assertFalse(any(w == 'the' for w, _ in json.loads(out)['top']))
        self.assertEqual(run('count', self.f, '--stopwords', os.path.join(self.tmp, 'nope'))[0], 3)
        code, out, err = run('count', self.f, '--json', '--top', '2'); d = json.loads(out); self.assertEqual(len(d['top']), 2); self.assertGreater(d['unique'], 2)
        a = run('count', self.f, '--json')[1]; b = run('count', self.f, '--json')[1]; self.assertEqual(a, b)

    def test_07_readme_and_final(self):
        r = open(os.path.join(REPO, 'README.md')).read().lower()
        for w in ('exit', 'gap', 'word'): self.assertIn(w, r)
        self.assertTrue(os.path.exists(FINAL), FINAL)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Adversarial tests for check_db_url.py. Offline: nothing connects.

Run: python3 .github/scripts/s3-migration/test_check_db_url.py
Each case runs the checker as a subprocess with a clean environment and
asserts the exit status, that stdout holds only ::add-mask:: lines, and that
no password text appears anywhere unmasked.
"""
import os
import subprocess
import sys
import unittest
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = os.path.join(HERE, "check_db_url.py")
REF = "anhaonrifwakoekksopv"
PW = "Xk9v2LmQ7tR4pZ8w"
HOST = "aws-0-us-west-2.pooler.supabase.com"
GOOD = f"postgresql://postgres.{REF}:{PW}@{HOST}:5432/postgres?sslmode=require"


def registered_masks(stdout):
    """What the GitHub runner registers for each ::add-mask:: line: it un-escapes
    %0D, %0A and then %25 in the value."""
    masks = []
    for line in stdout.splitlines():
        if line.startswith("::add-mask::"):
            masks.append(line[len("::add-mask::"):].replace("%0D", "\r").replace("%0A", "\n").replace("%25", "%"))
    return masks


def run(url, extra_env=None):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    if url is not None:
        env["SUPABASE_DB_URL"] = url
    env.update(extra_env or {})
    return subprocess.run([sys.executable, CHECK], env=env, capture_output=True, text=True, timeout=30)


ACCEPTED = {
    "approved pooler, aws-0": GOOD,
    "approved pooler, aws-1": GOOD.replace("aws-0-", "aws-1-"),
    "password with %XX escapes of reserved characters": GOOD.replace(PW, "Ab%40cd%2Cef%3Agh%2Fij"),
    "password with unreserved punctuation": GOOD.replace(PW, "Ab.cd_ef~gh-ij12"),
}

REJECTED = {
    # Multiple or alternate hosts
    "plain comma, attacker first": f"postgresql://postgres.{REF}:{PW}@evil.example.com,{HOST}:5432/postgres?sslmode=require",
    "plain comma, attacker with port": f"postgresql://postgres.{REF}:{PW}@evil.example.com:5432,{HOST}:5432/postgres?sslmode=require",
    "plain comma, approved first": f"postgresql://postgres.{REF}:{PW}@{HOST}:5432,evil.example.com:5432/postgres?sslmode=require",
    "%2C host separator": f"postgresql://postgres.{REF}:{PW}@evil.example.com%2C{HOST}:5432/postgres?sslmode=require",
    "%2c lowercase separator": f"postgresql://postgres.{REF}:{PW}@evil.example.com%2c{HOST}:5432/postgres?sslmode=require",
    "query host= override": GOOD + "&host=evil.example.com",
    "query hostaddr= override": GOOD + "&hostaddr=203.0.113.9",
    "query port= override": GOOD + "&port=6543",
    "query service= override": GOOD + "&service=evil",
    "query options=": GOOD + "&options=-c%20search_path%3Devil",
    "duplicate sslmode": GOOD + "&sslmode=disable",
    "sslmode=disable": GOOD.replace("sslmode=require", "sslmode=disable"),
    "sslmode=prefer": GOOD.replace("sslmode=require", "sslmode=prefer"),
    "no sslmode": GOOD.replace("?sslmode=require", ""),
    "fragment": GOOD + "#x",
    # Authority tricks
    "duplicate @": f"postgresql://postgres.{REF}:{PW}@evil.example.com@{HOST}:5432/postgres?sslmode=require",
    "raw @ in password": GOOD.replace(PW, "Ab@cdefghijkl"),
    "raw comma in password": GOOD.replace(PW, "Ab,cdefghijkl"),
    "raw colon in password": GOOD.replace(PW, "Ab:cdefghijkl"),
    "bracketed IPv6 host": f"postgresql://postgres.{REF}:{PW}@[::1]:5432/postgres?sslmode=require",
    "no password": f"postgresql://postgres.{REF}@{HOST}:5432/postgres?sslmode=require",
    "short password": GOOD.replace(PW, "short"),
    "encoded user": GOOD.replace(f"postgres.{REF}", "postgres.%61nhaonrifwakoekksopv"),
    "other project ref": GOOD.replace(REF, "anhvsbcncenemypvadhx"),
    "plain postgres user (direct form)": GOOD.replace(f"postgres.{REF}", "postgres"),
    # Hosts and ports
    "direct database host": f"postgresql://postgres:{PW}@db.{REF}.supabase.co:5432/postgres?sslmode=require",
    "other region pooler": GOOD.replace("us-west-2", "sa-east-1"),
    "look-alike suffix": GOOD.replace(HOST, HOST + ".evil.io"),
    "look-alike prefix": GOOD.replace(HOST, "evil-" + HOST),
    "look-alike subdomain": GOOD.replace(HOST, "x." + HOST),
    "uppercase host": GOOD.replace(HOST, HOST.upper()),
    "trailing dot host": GOOD.replace(HOST, HOST + "."),
    "transaction port 6543": GOOD.replace(":5432/", ":6543/"),
    "leading-zero port": GOOD.replace(":5432/", ":05432/"),
    "missing port": GOOD.replace(":5432/", "/"),
    "non-numeric port": GOOD.replace(":5432/", ":54a2/"),
    "other database": GOOD.replace("/postgres?", "/other?"),
    "scheme postgres://": GOOD.replace("postgresql://", "postgres://"),
    "uppercase scheme": GOOD.replace("postgresql://", "POSTGRESQL://"),
    # Control characters and whitespace, raw and encoded
    "raw tab in port": GOOD.replace(":5432/", ":54\t32/"),
    "raw newline in host": GOOD.replace(HOST, "aws-0-us-west-2.pooler\n.supabase.com"),
    "leading space": " " + GOOD,
    "trailing newline": GOOD + "\n",
    "encoded newline in password": GOOD.replace(PW, "Abcdefgh%0Aijklmn"),
    "encoded NUL in password": GOOD.replace(PW, "Abcdefgh%00ijklmn"),
    "encoded tab in password": GOOD.replace(PW, "Abcdefgh%09ijklmn"),
    "encoded space in password": GOOD.replace(PW, "Abcdefgh%20ijklmn"),
    "encoded zero-width space": GOOD.replace(PW, "Abcdefgh%E2%80%8Bijklmn"),
    "invalid UTF-8 escape": GOOD.replace(PW, "Abcdefgh%FFijklmn"),
    "malformed escape": GOOD.replace(PW, "Abcdefgh%G1ijklmn"),
    # Shell metacharacters (passed through the environment, never evaluated)
    "command substitution in password": GOOD.replace(PW, "$(touch${IFS}/tmp/pwned)abc"),
    "backticks and semicolon": GOOD.replace(PW, "`id`;rm${IFS}-rf${IFS}x"),
    "quotes and pipes": GOOD.replace(PW, "a'b\"c|d&e>f<g"),
    # Key=value conninfo instead of a URL
    "keyword conninfo": f"host={HOST} port=5432 user=postgres.{REF} password={PW} dbname=postgres sslmode=require",
    "empty": "",
}


class CheckDbUrl(unittest.TestCase):
    def assert_clean_output(self, result, url):
        lines = [line for line in result.stdout.splitlines() if line]
        self.assertTrue(all(line.startswith("::add-mask::") for line in lines), result.stdout)
        unmasked = result.stderr
        for secret in {PW, url.split("://", 1)[-1].rsplit("@", 1)[0]} if url else set():
            if len(secret) >= 4:
                self.assertNotIn(secret, unmasked)

    def test_accepted(self):
        for name, url in ACCEPTED.items():
            with self.subTest(name):
                result = run(url)
                self.assertEqual(result.returncode, 0, f"{name}: {result.stderr}")
                self.assertEqual(result.stderr, "")
                self.assert_clean_output(result, url)
                password = url.split("://", 1)[1].rsplit("@", 1)[0].split(":", 1)[1]
                self.assertIn(password, registered_masks(result.stdout))

    def test_rejected(self):
        for name, url in REJECTED.items():
            with self.subTest(name):
                result = run(url)
                self.assertEqual(result.returncode, 1, f"{name} was accepted")
                self.assertTrue(result.stderr.startswith("rejected: "), result.stderr)
                self.assert_clean_output(result, url)

    def test_masks_precede_any_other_output_and_are_single_line(self):
        url = GOOD.replace(PW, "Abcdefgh%0Aijklmnop")
        result = run(url)
        self.assertEqual(result.returncode, 1)
        masks = result.stdout.splitlines()
        self.assertIn("::add-mask::Abcdefgh", masks)
        self.assertIn("::add-mask::ijklmnop", masks)

    def test_mask_lines_are_escaped_and_register_the_literal_text(self):
        # N1: the runner un-escapes %25, %0D and %0A, so each must be sent escaped.
        cases = {
            "%25 in an accepted password": ("Ab%25cdefghijkl", 0, ["Ab%25cdefghijkl", "Ab%cdefghijkl"]),
            "%0A in the password": ("Abcdefgh%0Aijklmn", 1, ["Abcdefgh%0Aijklmn", "Abcdefgh", "ijklmn"]),
            "%0D in the password": ("Abcdefgh%0Dijklmn", 1, ["Abcdefgh%0Dijklmn", "Abcdefgh", "ijklmn"]),
            "%250A in the password": ("Abcdefgh%250Aijk", 0, ["Abcdefgh%250Aijk", "Abcdefgh%0Aijk"]),
        }
        for name, (password, status, literals) in cases.items():
            with self.subTest(name):
                url = GOOD.replace(PW, password)
                result = run(url)
                self.assertEqual(result.returncode, status, result.stderr)
                masks = registered_masks(result.stdout)
                for literal in literals:
                    self.assertIn(literal, masks)
                for line in result.stdout.splitlines():
                    value = line[len("::add-mask::"):]
                    self.assertNotIn("\r", value)
                    self.assertNotRegex(value, r"%(?!25|0D|0A)")
                self.assertTrue(all("\n" not in m and "\r" not in m for m in masks))
                # The registered masks cover the password wherever the URL is printed.
                text = url
                for mask in sorted(masks, key=len, reverse=True):
                    text = text.replace(mask, "***")
                self.assertNotIn(password, text)

    def test_password_length_counts_decoded_code_points(self):
        # W4: the 12-atom form allows 12 escapes that decode to 3 code points; the
        # minimum applies to the decoded value, which is what tools use and the runner masks.
        emoji, e_acute, cjk = "%F0%9F%98%80", "%C3%A9", "%E4%B8%AD"
        cases = {
            "literal ASCII, 11": ("Abcdefghijk", "form"),
            "literal ASCII, 12": ("Abcdefghijkl", None),
            "encoded ASCII, 11": ("%41" * 11, "form"),
            "encoded ASCII, 12": ("%41" * 12, None),
            "literal non-ASCII": ("Abcdéfghijkl", "form"),
            "emoji, 3 code points": (emoji * 3, "password-too-short"),
            "emoji, 4 code points": (emoji * 4, "password-too-short"),
            "emoji, 11 code points": (emoji * 11, "password-too-short"),
            "emoji, 11 plus one ASCII": (emoji * 11 + "A", None),
            "emoji, 12 code points": (emoji * 12, None),
            "2-byte, 11 code points": (e_acute * 11, "password-too-short"),
            "2-byte, 12 code points": (e_acute * 12, None),
            "3-byte, 4 code points": (cjk * 4, "password-too-short"),
            "3-byte, 12 code points": (cjk * 12, None),
            "mixed, 11 code points": ("Ab" + e_acute * 3 + emoji * 3 + "%25%25%25", "password-too-short"),
            "mixed, 12 code points": ("Abc" + e_acute * 3 + emoji * 3 + "%25%25%25", None),
        }
        for name, (password, reason) in cases.items():
            with self.subTest(name):
                url = GOOD.replace(PW, password)
                result = run(url)
                self.assert_clean_output(result, url)
                decoded = unquote(password, errors="strict")
                if reason == "password-too-short":
                    self.assertLess(len(decoded), 12)
                if reason is None:
                    self.assertEqual((result.returncode, result.stderr), (0, ""))
                    self.assertGreaterEqual(len(decoded), 12)
                    masks = registered_masks(result.stdout)
                    self.assertIn(password, masks)
                    self.assertIn(decoded, masks)
                else:
                    self.assertEqual((result.returncode, result.stderr), (1, f"rejected: {reason}\n"))

    def test_missing_variable(self):
        result = run(None)
        self.assertEqual((result.returncode, result.stdout), (1, ""))

    def test_pg_environment_overrides_refused(self):
        for name, value in [("PGHOSTADDR", "203.0.113.9"), ("PGHOST", "evil.example.com"), ("PGPORT", "6543"),
                            ("PGSERVICE", "evil"), ("PGOPTIONS", "-c x=y"), ("PGSSLMODE", "disable")]:
            with self.subTest(name):
                result = run(GOOD, {name: value})
                self.assertEqual(result.returncode, 1, f"{name} not refused")

    def test_no_shell_evaluation(self):
        run(REJECTED["command substitution in password"])
        self.assertFalse(os.path.exists("/tmp/pwned"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

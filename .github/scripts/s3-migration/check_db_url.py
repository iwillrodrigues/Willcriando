#!/usr/bin/env python3
"""Checks SUPABASE_DB_URL for the s3-migration workflow without connecting.

Accepts exactly one form, matched on the raw string before any decoding:

  postgresql://postgres.anhaonrifwakoekksopv:<password>@aws-<n>-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require

The password may only use unreserved characters and %XX escapes; once decoded
it must be valid UTF-8 without control, format or whitespace characters. The
accepted string is then parsed again by urllib and by libpq's own parser
(PQconninfoParse), and all three readings must agree on one host, port, user,
database and sslmode, with no other option set. PG* environment variables
that could redirect libpq or pgx are refused.

Output: only "::add-mask::" lines for password candidates, printed before any
check, and fixed reason codes on stderr. Never prints the value. Exit 0 when
accepted, 1 otherwise.
"""
import ctypes
import ctypes.util
import os
import re
import sys
import unicodedata
from urllib.parse import unquote, urlsplit

REF = "anhaonrifwakoekksopv"
USER = f"postgres.{REF}"
HOST = r"aws-[0-9]{1,2}-us-west-2\.pooler\.supabase\.com"
PASSWORD = r"(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2}){12,512}"
FORM = re.compile(rf"postgresql://postgres\.{REF}:(?P<pw>{PASSWORD})@(?P<host>{HOST}):5432/postgres\?sslmode=require")
# Variables libpq or pgx read as defaults or overrides. PGSSLMODE and
# PGCONNECT_TIMEOUT are allowed with fixed safe values only.
PG_ENV_REFUSED = ("PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPASSFILE",
                  "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGSYSCONFDIR", "PGTARGETSESSIONATTRS",
                  "PGREQUIREAUTH", "PGSSLNEGOTIATION", "PGLOADBALANCEHOSTS", "PGAPPNAME")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def reject(code):
    print(f"rejected: {code}", file=sys.stderr)
    sys.exit(1)


def command_escape(value):
    """Escapes a workflow command value. The runner un-escapes %25, %0D and %0A in
    ::add-mask:: values, so a literal "%25" in a password must be sent as "%2525"
    for the mask to cover the text as it appears."""
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def mask_candidates(raw):
    """Masks every plausible password substring, split on control characters so
    each ::add-mask:: line is single-line, and escaped so the runner registers the
    literal text. Runs before any validation output."""
    rest = raw.split("://", 1)[-1]
    candidates = set()
    for userinfo in (rest.split("@", 1)[0], rest.rsplit("@", 1)[0]):
        candidates.add(userinfo)
        if ":" in userinfo:
            candidates.add(userinfo.split(":", 1)[1])
    for value in list(candidates):
        candidates.add(unquote(value, errors="replace"))
    for value in candidates:
        for fragment in CONTROL.split(value):
            fragment = fragment.strip()
            if len(fragment) >= 4 and fragment not in (USER, "postgres", "postgresql"):
                print(f"::add-mask::{command_escape(fragment)}", flush=True)


def libpq_options(raw):
    path = ctypes.util.find_library("pq")
    if not path:
        reject("libpq-not-found")
    lib = ctypes.CDLL(path)

    class Option(ctypes.Structure):
        _fields_ = [("keyword", ctypes.c_char_p), ("envvar", ctypes.c_char_p), ("compiled", ctypes.c_char_p),
                    ("val", ctypes.c_char_p), ("label", ctypes.c_char_p), ("dispchar", ctypes.c_char_p),
                    ("dispsize", ctypes.c_int)]

    lib.PQconninfoParse.restype = ctypes.POINTER(Option)
    lib.PQconninfoParse.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p)]
    lib.PQconninfoFree.argtypes = [ctypes.POINTER(Option)]
    errmsg = ctypes.c_char_p()
    opts = lib.PQconninfoParse(raw.encode(), ctypes.byref(errmsg))
    if not opts:
        reject("libpq-parse-error")
    found = {}
    i = 0
    while opts[i].keyword is not None:
        if opts[i].val is not None:
            found[opts[i].keyword.decode()] = opts[i].val.decode("utf-8", errors="strict")
        i += 1
    lib.PQconninfoFree(opts)
    return found


def main():
    raw = os.environ.get("SUPABASE_DB_URL")
    if not raw:
        reject("missing")
    mask_candidates(raw)

    for name in PG_ENV_REFUSED:
        if os.environ.get(name):
            reject(f"environment-overrides-{name}")
    if os.environ.get("PGSSLMODE", "require") != "require":
        reject("environment-pgsslmode")

    m = FORM.fullmatch(raw)
    if not m:
        reject("form")
    try:
        password = unquote(m.group("pw"), errors="strict")
    except UnicodeDecodeError:
        reject("password-encoding")
    if any(unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp", "Zs") or c.isspace() for c in password):
        reject("password-control-or-space")

    u = urlsplit(raw)
    try:
        port = u.port
    except ValueError:
        reject("urllib-port")
    if not (u.scheme == "postgresql" and u.hostname == m.group("host") and port == 5432
            and u.username == USER and unquote(u.password or "", errors="strict") == password
            and u.path == "/postgres" and u.query == "sslmode=require" and not u.fragment):
        reject("urllib-disagrees")

    expected = {"host": m.group("host"), "port": "5432", "user": USER, "password": password,
                "dbname": "postgres", "sslmode": "require"}
    if libpq_options(raw) != expected:
        reject("libpq-disagrees")
    sys.exit(0)


if __name__ == "__main__":
    main()

// Run with: npm test   (node --test, no test framework needed)
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeConnection,
  formatConnectionString,
  looksLikeConnectionString,
  type ParsedConnection,
  parseConnectionString,
} from "./conn-string.ts";

/** Parsed value, or the error message — keeps the assertions to one line. */
function parse(s: string): ParsedConnection | { error: string | undefined } {
  const r = parseConnectionString(s);
  return r.ok && r.value ? r.value : { error: r.error };
}

function warnings(s: string): string[] {
  return parseConnectionString(s).warnings;
}

const BACKSLASH = String.fromCodePoint(92);

describe("URI form", () => {
  test("full URI", () => {
    assert.deepEqual(
      parse(
        "postgresql://alice:s3cret@db.example.com:6543/shop?sslmode=require",
      ),
      {
        host: "db.example.com",
        port: 6543,
        user: "alice",
        password: "s3cret",
        database: "shop",
        ssl: "require",
      },
    );
  });

  test("postgres:// scheme, no password", () => {
    assert.deepEqual(parse("postgres://bob@localhost/mydb"), {
      host: "localhost",
      port: 5432,
      user: "bob",
      password: "",
      database: "mydb",
      ssl: "disable",
    });
  });

  test("empty host means local", () => {
    assert.equal(
      (parse("postgres:///mydb") as ParsedConnection).host,
      "127.0.0.1",
    );
  });

  test("percent-encoded credentials are decoded", () => {
    const c = parse(
      "postgresql://us%65r:p%40ss%20word@h/db",
    ) as ParsedConnection;
    assert.equal(c.user, "user");
    assert.equal(c.password, "p@ss word");
  });

  test("IPv6 loses its brackets for the driver", () => {
    assert.equal(
      (parse("postgresql://u:p@[2001:db8::1]:5432/d") as ParsedConnection).host,
      "2001:db8::1",
    );
  });

  test("hosted-provider shapes", () => {
    assert.deepEqual(
      parse(
        "postgresql://postgres.abcdefgh:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
      ),
      {
        host: "aws-0-eu-west-1.pooler.supabase.com",
        port: 6543,
        user: "postgres.abcdefgh",
        password: "pw",
        database: "postgres",
        ssl: "disable",
      },
    );
    assert.equal(
      (
        parse(
          "postgresql://me:pw@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require",
        ) as ParsedConnection
      ).ssl,
      "require",
    );
  });
});

describe("sslmode mapping", () => {
  test("verify-ca and verify-full both mean verify", () => {
    assert.equal(
      (parse("postgres://h/d?sslmode=verify-ca") as ParsedConnection).ssl,
      "verify",
    );
    assert.equal(
      (parse("postgres://h/d?sslmode=verify-full") as ParsedConnection).ssl,
      "verify",
    );
  });

  test("opportunistic modes downgrade, and say so", () => {
    assert.equal(
      (parse("postgres://h/d?sslmode=prefer") as ParsedConnection).ssl,
      "disable",
    );
    assert.equal(warnings("postgres://h/d?sslmode=prefer").length, 1);
    assert.equal(warnings("postgres://h/d?sslmode=allow").length, 1);
  });

  test("an unknown mode is an error, not a guess", () => {
    assert.deepEqual(parse("postgres://h/d?sslmode=nope"), {
      error: 'Unknown sslmode "nope".',
    });
  });
});

describe("keyword/value DSN", () => {
  test("plain pairs", () => {
    assert.deepEqual(
      parse(
        "host=localhost port=5432 dbname=mydb user=postgres password=secret",
      ),
      {
        host: "localhost",
        port: 5432,
        user: "postgres",
        password: "secret",
        database: "mydb",
        ssl: "disable",
      },
    );
  });

  test("quoted value keeps its spaces", () => {
    assert.equal(
      (parse("host=h dbname=d password='p a ss'") as ParsedConnection).password,
      "p a ss",
    );
  });

  test("backslash escapes the quote", () => {
    const dsn = `host=h dbname=d password='p${BACKSLASH}'s'`;
    assert.equal((parse(dsn) as ParsedConnection).password, "p's");
  });

  test("whitespace around = is allowed", () => {
    assert.equal((parse("host = h  dbname = d") as ParsedConnection).host, "h");
  });

  test("unterminated quote is reported against its key", () => {
    assert.deepEqual(parse("host=h password='oops"), {
      error: 'Unterminated quote in "password".',
    });
  });

  test("a half-written pair names the key", () => {
    assert.deepEqual(parse("host=h dbname"), {
      error: 'Expected "=" after "dbname".',
    });
  });
});

describe("lossy inputs are reported, never silent", () => {
  test("unknown parameters are listed", () => {
    assert.deepEqual(
      warnings("postgres://h/d?connect_timeout=10&application_name=x"),
      ["Ignored parameters: connect_timeout, application_name."],
    );
    assert.deepEqual(warnings("host=h dbname=d target_session_attrs=rw"), [
      "Ignored parameter: target_session_attrs.",
    ]);
  });

  test("a failover host list keeps the first host", () => {
    const c = parse("postgres://u@a.com,b.com/d") as ParsedConnection;
    assert.equal(c.host, "a.com");
    assert.equal(warnings("postgres://u@a.com,b.com/d").length, 1);
  });
});

describe("rejections", () => {
  test("empty input is not an error to shout about", () => {
    assert.equal(parseConnectionString("   ").ok, false);
    assert.equal(parseConnectionString("   ").error, "");
  });

  test("another database's scheme", () => {
    assert.deepEqual(parse("mysql://u@h/d"), {
      error: "Only postgres:// and postgresql:// URIs are supported.",
    });
  });

  test("out-of-range port names the port", () => {
    assert.deepEqual(parse("postgres://h:99999/d"), {
      error: 'Invalid port "99999".',
    });
  });

  test("prose gets an error that explains the input, not the parser", () => {
    assert.deepEqual(parse("hostname"), {
      error:
        "Expected a postgresql:// URI, or key=value pairs such as 'host=… dbname=…'.",
    });
  });
});

describe("sniffing a pasted blob", () => {
  test("recognises both forms", () => {
    assert.equal(looksLikeConnectionString("postgres://h/d"), true);
    assert.equal(looksLikeConnectionString("host=h dbname=d"), true);
  });

  test("a bare hostname is not a connection string", () => {
    assert.equal(looksLikeConnectionString("db.example.com"), false);
    // One keyword could be someone typing a hostname that contains "host=".
    assert.equal(looksLikeConnectionString("host=db.example.com"), false);
  });
});

describe("formatting back out", () => {
  const cfg: ParsedConnection = {
    host: "db.example.com",
    port: 6543,
    user: "alice",
    password: "p@ss word",
    database: "shop",
    ssl: "require",
  };

  test("round trips", () => {
    const s = formatConnectionString(cfg);
    assert.equal(
      s,
      "postgresql://alice:p%40ss%20word@db.example.com:6543/shop?sslmode=require",
    );
    assert.deepEqual(parse(s), cfg);
  });

  test("IPv6 gets its brackets back, and survives the trip", () => {
    const ipv6: ParsedConnection = {
      host: "2001:db8::1",
      port: 5432,
      user: "u",
      password: "",
      database: "d",
      ssl: "disable",
    };
    assert.equal(
      formatConnectionString(ipv6),
      "postgresql://u@[2001:db8::1]/d",
    );
    assert.deepEqual(parse(formatConnectionString(ipv6)), ipv6);
  });

  test("masking hides only the password", () => {
    assert.equal(
      formatConnectionString(cfg, { maskPassword: true }),
      "postgresql://alice:••••••@db.example.com:6543/shop?sslmode=require",
    );
  });

  test("the summary line brackets IPv6 so the port stays readable", () => {
    assert.equal(
      describeConnection(cfg),
      "alice@db.example.com:6543/shop · SSL require",
    );
    assert.equal(
      describeConnection({
        host: "2001:db8::1",
        port: 5432,
        user: "u",
        password: "",
        database: "d",
        ssl: "disable",
      }),
      "u@[2001:db8::1]:5432/d · no SSL",
    );
  });
});

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

// Simple hash-router utilities (no external deps)
const useHashRoute = () => {
  const [hash, setHash] = useState(window.location.hash || "#/" );
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const path = hash.replace(/^#/, "");
  return [path, (p) => (window.location.hash = p)];
};

// --- Storage helpers ---
const STORAGE_KEY = "url_shortener_links_v1";

function loadLinks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveLinks(links) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

// --- Utility helpers ---
const isValidUrl = (url) => {
  try {
    const u = new URL(url);
    // basic scheme allowlist
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
};

const now = () => Date.now();

const defaultExpiryMs = 30 * 60 * 1000; // 30 min

const randomBase62 = (len = 6) => {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const arr = new Uint32Array(len);
    cryptoObj.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  // Fallback (less strong but fine for client-only uniqueness)
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const aliasRegex = /^[a-zA-Z0-9_-]{3,30}$/;

const fmtDateTime = (ts) => new Date(ts).toLocaleString();

const timeLeft = (expiresAt) => {
  const diff = expiresAt - now();
  if (diff <= 0) return { text: "Expired", expired: true };
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { text: `${m}m ${s}s`, expired: false };
};

const buildShortUrl = (code) => {
  const base = window.location.origin + window.location.pathname + "#"; // hash router
  return base + "/r/" + encodeURIComponent(code);
};

// --- Types ---
// Link: { id, originalUrl, code, createdAt, expiresAt, clicks: [{ts, ref}] }

// --- App UI ---
function App() {
  const [route, navigate] = useHashRoute();
  const [links, setLinks] = useState(loadLinks());

  useEffect(() => {
    saveLinks(links);
  }, [links]);

  // purge fully expired items older than a week (housekeeping)
  useEffect(() => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const pruned = links.filter((l) => l.expiresAt + week > now());
    if (pruned.length !== links.length) setLinks(pruned);
    // eslint-disable-next-line
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Header route={route} navigate={navigate} />
      <main className="max-w-5xl mx-auto px-4 pb-24">
        {route.startsWith("/r/") ? (
          <Redirector code={route.split("/r/")[1]} links={links} setLinks={setLinks} navigate={navigate} />
        ) : route.startsWith("/analytics") ? (
          <Analytics links={links} setLinks={setLinks} />
        ) : route.startsWith("/help") ? (
          <Help />
        ) : (
          <Home onCreate={(l) => setLinks([l, ...links])} links={links} />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Header({ route, navigate }) {
  const tabs = [
    { path: "/", label: "Shorten" },
    { path: "/analytics", label: "Analytics" },
    { path: "/help", label: "Help" },
  ];
  return (
    <header className="bg-white sticky top-0 z-10 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div onClick={() => (window.location.hash = "/")} className="cursor-pointer">
          <h1 className="text-xl sm:text-2xl font-bold">Snipster<span className="text-indigo-600">.link</span></h1>
          <p className="text-xs text-gray-500 -mt-1">Client‑side URL shortener</p>
        </div>
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.path}
              onClick={() => (window.location.hash = t.path)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition shadow-sm hover:shadow ${
                route.startsWith(t.path)
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Home({ onCreate, links }) {
  return (
    <section className="mt-8 grid gap-6">
      <ShortenerForm onCreate={onCreate} links={links} />
      <RecentList links={links.slice(0, 5)} />
    </section>
  );
}

function ShortenerForm({ onCreate, links }) {
  const [originalUrl, setOriginalUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiryMin, setExpiryMin] = useState(30); // allow override but default 30
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  const existingCodes = useMemo(() => new Set(links.map((l) => l.code)), [links]);

  const makeUniqueCode = () => {
    let code = randomBase62(7);
    let guard = 0;
    while (existingCodes.has(code) && guard < 100) {
      code = randomBase62(7);
      guard++;
    }
    return code;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const url = originalUrl.trim();
    if (!url) return setError("Please enter a URL.");
    if (!isValidUrl(url)) return setError("Please enter a valid http(s) URL.");

    let code = alias.trim();
    if (code) {
      if (!aliasRegex.test(code)) return setError("Custom alias must be 3–30 chars: letters, numbers, _ or -");
      if (existingCodes.has(code)) return setError("That alias is already taken. Try another.");
    } else {
      code = makeUniqueCode();
    }

    const minutes = Number(expiryMin) || 30;
    const createdAt = now();
    const expiresAt = createdAt + minutes * 60 * 1000;

    const link = {
      id: `${createdAt}-${code}`,
      originalUrl: url,
      code,
      createdAt,
      expiresAt,
      clicks: [],
    };

    onCreate(link);
    setSuccess({ code });
    setOriginalUrl("");
    setAlias("");
    setExpiryMin(30);
  };

  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <h2 className="text-lg font-semibold mb-4">Create a short link</h2>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Destination URL</label>
          <input
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
            placeholder="https://example.com/very/long/path?with=params"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium flex items-center justify-between">
              <span>Custom alias (optional)</span>
              <span className="text-xs text-gray-500">a–Z, 0–9, -, _</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="hidden sm:block text-gray-500 bg-gray-100 px-2 py-2 rounded-lg select-none">
                {window.location.origin + window.location.pathname}#/r/
              </span>
              <input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="my-custom-link"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Validity (minutes)</label>
            <input
              type="number"
              min={1}
              max={24 * 60}
              value={expiryMin}
              onChange={(e) => setExpiryMin(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500">Defaults to 30 minutes if unchanged.</p>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
        )}
        {success && (
          <SuccessBanner code={success.code} />
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium shadow hover:bg-indigo-700 disabled:opacity-50"
          >
            Shorten URL
          </button>
          <button
            type="button"
            onClick={() => { setOriginalUrl(""); setAlias(""); setExpiryMin(30); setError(null); setSuccess(null); }}
            className="bg-gray-200 text-gray-900 px-4 py-2 rounded-xl font-medium hover:bg-gray-300"
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}

function SuccessBanner({ code }) {
  const shortLink = buildShortUrl(code);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shortLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm flex items-center justify-between">
      <div>
        <div className="font-medium text-green-800">Short link created!</div>
        <a href={`#${"/r/" + encodeURIComponent(code)}`} className="text-green-700 underline break-all">{shortLink}</a>
      </div>
      <div className="flex gap-2">
        <button onClick={copy} className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700">
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={`#${"/analytics"}`} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black">View Analytics</a>
      </div>
    </div>
  );
}

function RecentList({ links }) {
  if (!links.length) return null;
  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <h3 className="text-base font-semibold mb-3">Recent links</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2 pr-4">Short</th>
              <th className="py-2 pr-4">Destination</th>
              <th className="py-2 pr-4">Clicks</th>
              <th className="py-2 pr-4">Expires</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => {
              const tl = timeLeft(l.expiresAt);
              return (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="py-2 pr-4">
                    <a className="text-indigo-600 underline" href={`#${"/r/" + encodeURIComponent(l.code)}`}>{buildShortUrl(l.code)}</a>
                  </td>
                  <td className="py-2 pr-4 max-w-[380px] truncate" title={l.originalUrl}>{l.originalUrl}</td>
                  <td className="py-2 pr-4">{l.clicks.length}</td>
                  <td className="py-2 pr-4">{tl.text}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Analytics({ links, setLinks }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return links;
    return links.filter((l) =>
      l.originalUrl.toLowerCase().includes(term) || l.code.toLowerCase().includes(term)
    );
  }, [q, links]);

  const remove = (id) => {
    if (!confirm("Delete this link? This cannot be undone.")) return;
    setLinks(links.filter((l) => l.id !== id));
  };

  return (
    <section className="mt-8 grid gap-6">
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">Analytics</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by alias or URL"
            className="rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">Links appear here immediately after you shorten them. Expired links stop redirecting but remain in the list unless deleted.</p>
      </div>

      <div className="bg-white rounded-2xl shadow">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-3 pl-5 pr-4">Short</th>
                <th className="py-3 pr-4">Destination</th>
                <th className="py-3 pr-4">Created</th>
                <th className="py-3 pr-4">Expires</th>
                <th className="py-3 pr-4">Clicks</th>
                <th className="py-3 pr-4">Last Click</th>
                <th className="py-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const tl = timeLeft(l.expiresAt);
                const last = l.clicks.length ? fmtDateTime(l.clicks[l.clicks.length - 1].ts) : "—";
                return (
                  <tr key={l.id} className="border-t border-gray-100 align-top">
                    <td className="py-3 pl-5 pr-4 max-w-[280px] break-words">
                      <a className="text-indigo-600 underline" href={`#${"/r/" + encodeURIComponent(l.code)}`}>{buildShortUrl(l.code)}</a>
                      <div className="text-xs text-gray-500">/{l.code}</div>
                    </td>
                    <td className="py-3 pr-4 max-w-[380px] break-words">
                      <a className="underline text-gray-800 break-words" href={l.originalUrl} target="_blank" rel="noreferrer">{l.originalUrl}</a>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span className={tl.expired ? "text-red-600" : ""}>{tl.text}</span>
                    </td>
                    <td className="py-3 pr-4">{l.clicks.length}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{last}</td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-2">
                        <CopyButton text={buildShortUrl(l.code)} />
                        <button onClick={() => remove(l.id)} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="text-center text-gray-500 py-10">No links match your search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CopyButton({ text }) {
  const [label, setLabel] = useState("Copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setLabel("Copied!");
      setTimeout(() => setLabel("Copy"), 1200);
    } catch {
      setLabel("Failed");
      setTimeout(() => setLabel("Copy"), 1200);
    }
  };
  return (
    <button onClick={copy} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black">{label}</button>
  );
}

function Redirector({ code = "", links, setLinks, navigate }) {
  const decoded = decodeURIComponent(code);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const link = links.find((l) => l.code === decoded);
    if (!link) {
      setStatus("error");
      setMessage("This short link does not exist.");
      return;
    }
    if (now() > link.expiresAt) {
      setStatus("expired");
      return;
    }
    // log click
    const ref = document.referrer || "direct";
    const updated = links.map((l) =>
      l.id === link.id ? { ...l, clicks: [...l.clicks, { ts: now(), ref }] } : l
    );
    setLinks(updated);
    // redirect after a tiny pause so state persists
    setTimeout(() => {
      window.location.href = link.originalUrl;
    }, 250);
  }, [code]);

  if (status === "loading") {
    return (
      <div className="mt-12 bg-white rounded-2xl shadow p-8 text-center">
        <p className="text-sm text-gray-500 mb-2">Redirecting…</p>
        <p className="text-gray-900">/{decoded}</p>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="mt-12 bg-white rounded-2xl shadow p-8 text-center">
        <h2 className="text-xl font-semibold mb-2">Link expired</h2>
        <p className="text-gray-600">This short link has passed its validity window.</p>
        <button onClick={() => (window.location.hash = "/")} className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white">Create a new one</button>
      </div>
    );
  }

  return (
    <div className="mt-12 bg-white rounded-2xl shadow p-8 text-center">
      <h2 className="text-xl font-semibold mb-1">Not found</h2>
      <p className="text-gray-600">{message}</p>
      <button onClick={() => (window.location.hash = "/")} className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white">Go home</button>
    </div>
  );
}

function Help() {
  return (
    <section className="mt-8 bg-white rounded-2xl shadow p-6 grid gap-4">
      <h2 className="text-lg font-semibold">How it works</h2>
      <ol className="list-decimal ml-5 grid gap-2 text-sm text-gray-700">
        <li>Paste any <strong>http(s)</strong> URL and optionally set a custom alias.</li>
        <li>Each link is stored <em>locally</em> in your browser and is unique within this device.</li>
        <li>Links default to <strong>30 minutes</strong> validity (you can set a different duration).</li>
        <li>The short format is <code>#/r/&lt;alias&gt;</code> which works via the in‑app hash router.</li>
        <li>Click events are tracked client‑side and visible in the Analytics tab.</li>
      </ol>
      <h3 className="font-semibold mt-2">Limits</h3>
      <ul className="list-disc ml-5 text-sm text-gray-700">
        <li>No server is used; links only exist on this browser/device.</li>
        <li>Uniqueness and analytics are enforced locally. Clearing storage deletes data.</li>
        <li>For sharing publicly, deploy this app so others' browsers can resolve the <code>#/r/&lt;alias&gt;</code> routes.</li>
      </ul>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-16 text-center text-xs text-gray-500">
      <div className="max-w-5xl mx-auto px-4 py-10">
        Built with React & Tailwind. All data lives in your browser.
      </div>
    </footer>
  );
}

export default App;

// Auto-mount if a root div exists (for previews)
if (typeof document !== "undefined") {
  const mount = document.getElementById("root") || (() => {
    const d = document.createElement("div");
    d.id = "root";
    document.body.appendChild(d);
    return d;
  })();
  const root = createRoot(mount);
  root.render(<App />);
}

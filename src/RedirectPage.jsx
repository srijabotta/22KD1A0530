import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function RedirectPage() {
  const { code } = useParams();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const links = JSON.parse(localStorage.getItem("shortLinks") || "[]");
    const link = links.find(l => l.code === code);

    if (!link) {
      setStatus("notfound");
      return;
    }

    if (Date.now() > link.expiresAt) {
      setStatus("expired");
      return;
    }

    // Log the click
    link.clicks.push(Date.now());
    localStorage.setItem(
      "shortLinks",
      JSON.stringify(
        links.map(l => (l.code === code ? link : l))
      )
    );

    // Redirect after short delay
    window.location.href = link.originalUrl;
  }, [code]);

  if (status === "loading") return <div className="mt-20 text-center">Redirecting…</div>;
  if (status === "expired") return <div className="mt-20 text-center text-red-600">This link has expired.</div>;
  if (status === "notfound") return <div className="mt-20 text-center text-gray-600">URL not found.</div>;

  return null;
}

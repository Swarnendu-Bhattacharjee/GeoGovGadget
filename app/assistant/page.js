"use client";

import { useRef, useState } from "react";

const SUGGESTIONS = [
  "Which parcels are still pending verification?",
  "Are there any encroachment risks right now?",
  "How is a building's height estimated on the 3D map?",
  "What does 'confidence' mean on a detected parcel?",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  async function send(question) {
    if (!question.trim() || loading) return;
    setError(null);
    const nextMessages = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
    } catch (e) {
      setError("Network error reaching the assistant.");
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-line px-6 py-5">
        <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
          24/7 Plot Query Interface
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1">
          AI Assistant
        </h1>
        <p className="text-muted text-sm mt-1 max-w-2xl">
          Ask about any plot's status, ward, ownership type, or verification history in plain
          language — built for officials who need an answer in seconds, not a report request.
        </p>
      </header>

      <section className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-6">
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-[320px]">
          {messages.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted font-mono uppercase tracking-wide mb-1">Try asking</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-xs border border-line rounded-lg px-3 py-2 hover:bg-surface2 transition text-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-accent text-ink self-end"
                  : "bg-surface border border-line self-start"
              }`}
            >
              {m.content}
            </div>
          ))}

          {loading && (
            <div className="self-start bg-surface border border-line rounded-xl px-4 py-3 text-sm text-muted font-mono">
              thinking…
            </div>
          )}

          {error && (
            <div className="self-start bg-[#2a1414] border border-bad/40 text-bad rounded-xl px-4 py-3 text-xs font-mono max-w-[90%]">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 mt-4 border-t border-line pt-4"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a plot, ward, or verification status…"
            className="flex-1 bg-surface2 border border-line rounded-lg px-4 py-3 text-sm outline-none focus:border-accent2"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-accent text-ink font-semibold text-sm px-5 py-3 rounded-lg hover:brightness-110 transition disabled:opacity-40"
          >
            Ask
          </button>
        </form>
      </section>
    </main>
  );
}

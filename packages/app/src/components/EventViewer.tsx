/**
 * EventViewer — displays decoded events from a transaction receipt.
 *
 * Features:
 * - Type conversion toggles (wei/ether, hex/decimal, timestamps)
 * - Expandable event args
 * - Copy-friendly values
 */

import React, { useState, useCallback } from "react";
import type { DecodedEvent } from "../types";

interface EventViewerProps {
  events: DecodedEvent[];
  loading?: boolean;
}

type DisplayMode = "raw" | "formatted";

// ─── Value Formatting ───────────────────────────────────────────

function isLargeNumber(value: string): boolean {
  try {
    return /^\d+$/.test(value) && value.length > 10;
  } catch {
    return false;
  }
}

function formatWei(value: string): string {
  try {
    const num = BigInt(value);
    const eth = Number(num) / 1e18;
    if (eth === 0 && num > 0n) return `~0 ETH (${value} wei)`;
    return `${eth.toFixed(eth < 0.001 ? 8 : 4)} ETH`;
  } catch {
    return value;
  }
}

function isHex(value: string): boolean {
  return /^0x[a-fA-F0-9]+$/.test(value) && value.length > 10;
}

function hexToDecimal(value: string): string {
  try {
    return BigInt(value).toString(10);
  } catch {
    return value;
  }
}

function isTimestamp(value: string): boolean {
  try {
    const num = parseInt(value, 10);
    // Likely a unix timestamp if between 2015 and 2040
    return num > 1420000000 && num < 2200000000;
  } catch {
    return false;
  }
}

function formatTimestamp(value: string): string {
  try {
    return new Date(parseInt(value, 10) * 1000).toLocaleString();
  } catch {
    return value;
  }
}

// ─── Event Arg Value Display ────────────────────────────────────

function ArgValue({ name, value, mode }: { name: string; value: any; mode: DisplayMode }) {
  const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
  const [copied, setCopied] = useState(false);

  const copyValue = () => {
    navigator.clipboard.writeText(strValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Determine if we can offer conversions
  const showWei = mode === "formatted" && isLargeNumber(strValue);
  const showHexDec = mode === "formatted" && isHex(strValue);
  const showTimestamp = mode === "formatted" && isTimestamp(strValue);

  return (
    <div className="flex items-start gap-2 py-1.5 group">
      <span className="text-gray-500 text-[11px] min-w-[80px] pt-0.5">{name}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-white text-[12px] font-mono break-all">{strValue}</span>
          <button
            onClick={copyValue}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-white/[0.06] transition-all"
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>

        {/* Converted values */}
        {showWei && (
          <p className="text-[10px] text-green-400/70 mt-0.5">{formatWei(strValue)}</p>
        )}
        {showHexDec && (
          <p className="text-[10px] text-blue-400/70 mt-0.5">= {hexToDecimal(strValue)}</p>
        )}
        {showTimestamp && (
          <p className="text-[10px] text-yellow-400/70 mt-0.5">{formatTimestamp(strValue)}</p>
        )}
      </div>
    </div>
  );
}

// ─── Single Event Card ──────────────────────────────────────────

function EventCard({ event, mode }: { event: DecodedEvent; mode: DisplayMode }) {
  const [expanded, setExpanded] = useState(true);
  const argEntries = Object.entries(event.args);

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`text-gray-600 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M8 5v14l11-7z" />
        </svg>
        <span className="text-purple-400 text-[12px] font-medium">{event.name}</span>
        <span className="text-gray-600 text-[10px]">#{event.logIndex}</span>
        <span className="text-gray-700 text-[10px] font-mono ml-auto truncate max-w-[200px]">
          {event.address}
        </span>
      </button>

      {expanded && argEntries.length > 0 && (
        <div className="px-3 pb-2.5 border-t border-white/[0.04]">
          {argEntries.map(([name, value]) => (
            <ArgValue key={name} name={name} value={value} mode={mode} />
          ))}
        </div>
      )}

      {expanded && argEntries.length === 0 && (
        <div className="px-3 pb-2.5 border-t border-white/[0.04]">
          <p className="text-gray-600 text-[11px] py-1.5">No indexed or data parameters</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function EventViewer({ events, loading }: EventViewerProps) {
  const [mode, setMode] = useState<DisplayMode>("formatted");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-gray-700 border-t-purple-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-gray-600 text-[12px]">No events found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 text-[11px]">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setMode("raw")}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              mode === "raw"
                ? "bg-white/[0.08] text-white"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            Raw
          </button>
          <button
            onClick={() => setMode("formatted")}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              mode === "formatted"
                ? "bg-white/[0.08] text-white"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            Formatted
          </button>
        </div>
      </div>

      {events.map((event, i) => (
        <EventCard key={`${event.name}-${event.logIndex}-${i}`} event={event} mode={mode} />
      ))}
    </div>
  );
}

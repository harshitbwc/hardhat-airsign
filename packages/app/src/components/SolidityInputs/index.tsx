/**
 * SolidityInputs — type-smart input components for Solidity function parameters.
 *
 * Each component handles validation and conversion for its Solidity type.
 * The main export `SolidityInput` dispatches to the correct component based
 * on the ABI param type string (e.g. "address", "uint256", "bool", etc.).
 */

import React, { useState, useCallback } from "react";
import type { ABIParam } from "../../types";

// ─── Shared Styles ──────────────────────────────────────────────

const inputClass =
  "w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-colors font-mono";

const labelClass = "text-[11px] text-gray-500 mb-1 flex items-center gap-1.5";
const errorClass = "text-[10px] text-red-400 mt-1";

// ─── Shared Props ───────────────────────────────────────────────

interface InputProps {
  param: ABIParam;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// ─── Address Input ──────────────────────────────────────────────

function AddressInput({ param, value, onChange, disabled }: InputProps) {
  const isValid = !value || /^0x[a-fA-F0-9]{40}$/.test(value);

  return (
    <div>
      <label className={labelClass}>
        <span className="text-blue-400">address</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <input
        className={`${inputClass} ${!isValid ? "border-red-500/50" : ""}`}
        placeholder="0x..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
      />
      {!isValid && <p className={errorClass}>Invalid address (expected 0x + 40 hex chars)</p>}
    </div>
  );
}

// ─── Uint / Int Input ───────────────────────────────────────────

function UintInput({ param, value, onChange, disabled }: InputProps) {
  const isSigned = param.type.startsWith("int");
  const isValid = !value || (isSigned ? /^-?\d+$/.test(value) : /^\d+$/.test(value));

  return (
    <div>
      <label className={labelClass}>
        <span className="text-green-400">{param.type}</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <input
        className={`${inputClass} ${!isValid ? "border-red-500/50" : ""}`}
        placeholder={isSigned ? "0" : "0"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        inputMode="numeric"
      />
      {!isValid && (
        <p className={errorClass}>
          {isSigned ? "Expected integer value" : "Expected non-negative integer"}
        </p>
      )}
    </div>
  );
}

// ─── Bool Input ─────────────────────────────────────────────────

function BoolInput({ param, value, onChange, disabled }: InputProps) {
  return (
    <div>
      <label className={labelClass}>
        <span className="text-yellow-400">bool</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange("true")}
          disabled={disabled}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            value === "true"
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-white/[0.04] text-gray-500 border border-white/[0.08] hover:border-white/[0.12]"
          }`}
        >
          true
        </button>
        <button
          type="button"
          onClick={() => onChange("false")}
          disabled={disabled}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            value === "false"
              ? "bg-red-500/20 text-red-400 border border-red-500/30"
              : "bg-white/[0.04] text-gray-500 border border-white/[0.08] hover:border-white/[0.12]"
          }`}
        >
          false
        </button>
      </div>
    </div>
  );
}

// ─── Bytes Input ────────────────────────────────────────────────

function BytesInput({ param, value, onChange, disabled }: InputProps) {
  const isFixed = /^bytes\d+$/.test(param.type);
  const expectedLen = isFixed ? parseInt(param.type.replace("bytes", ""), 10) * 2 + 2 : 0;
  const isValid = !value || /^0x([a-fA-F0-9]*)$/.test(value);
  const isLenValid = !isFixed || !value || value.length === expectedLen;

  return (
    <div>
      <label className={labelClass}>
        <span className="text-purple-400">{param.type}</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <input
        className={`${inputClass} ${!isValid || !isLenValid ? "border-red-500/50" : ""}`}
        placeholder={isFixed ? `0x${"00".repeat(parseInt(param.type.replace("bytes", ""), 10) || 1)}` : "0x..."}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
      />
      {!isValid && <p className={errorClass}>Expected hex bytes (0x...)</p>}
      {isValid && !isLenValid && (
        <p className={errorClass}>Expected {expectedLen} chars for {param.type}</p>
      )}
    </div>
  );
}

// ─── String Input ───────────────────────────────────────────────

function StringInput({ param, value, onChange, disabled }: InputProps) {
  return (
    <div>
      <label className={labelClass}>
        <span className="text-orange-400">string</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <input
        className={inputClass}
        placeholder='""'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

// ─── Array Input (e.g. uint256[], address[]) ────────────────────

function ArrayInput({ param, value, onChange, disabled }: InputProps) {
  return (
    <div>
      <label className={labelClass}>
        <span className="text-cyan-400">{param.type}</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <textarea
        className={`${inputClass} min-h-[60px] resize-y`}
        placeholder={`[value1, value2, ...] or JSON array`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
      />
      <p className="text-[10px] text-gray-600 mt-1">
        Enter as JSON array, e.g. ["0x...", "0x..."] or [1, 2, 3]
      </p>
    </div>
  );
}

// ─── Tuple Input (struct) ───────────────────────────────────────

function TupleInput({ param, value, onChange, disabled }: InputProps) {
  return (
    <div>
      <label className={labelClass}>
        <span className="text-pink-400">tuple</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
        {param.internalType && (
          <span className="text-gray-600 text-[10px]">({param.internalType})</span>
        )}
      </label>
      <textarea
        className={`${inputClass} min-h-[60px] resize-y`}
        placeholder={`JSON object with fields: ${
          param.components?.map((c) => c.name || c.type).join(", ") || "..."
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
      />
      {param.components && (
        <p className="text-[10px] text-gray-600 mt-1">
          Fields: {param.components.map((c) => `${c.name}: ${c.type}`).join(", ")}
        </p>
      )}
    </div>
  );
}

// ─── Fallback (enum, custom types) ──────────────────────────────

function GenericInput({ param, value, onChange, disabled }: InputProps) {
  return (
    <div>
      <label className={labelClass}>
        <span className="text-gray-400">{param.type}</span>
        {param.name && <span className="text-gray-400">{param.name}</span>}
      </label>
      <input
        className={inputClass}
        placeholder={param.type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

// ─── Main Dispatcher ────────────────────────────────────────────

export function SolidityInput(props: InputProps) {
  const { param } = props;
  const type = param.type;

  if (type === "address") return <AddressInput {...props} />;
  if (type === "bool") return <BoolInput {...props} />;
  if (type === "string") return <StringInput {...props} />;
  if (/^u?int\d*$/.test(type)) return <UintInput {...props} />;
  if (/^bytes\d*$/.test(type)) return <BytesInput {...props} />;
  if (type.endsWith("[]")) return <ArrayInput {...props} />;
  if (type === "tuple" || type.startsWith("tuple")) return <TupleInput {...props} />;

  return <GenericInput {...props} />;
}

// ─── Value Parser (string → actual arg for ethers call) ─────────

/**
 * Parse a user-entered string into the proper JS value for an ethers call.
 * Returns the parsed value or throws if invalid.
 */
export function parseInputValue(type: string, raw: string): any {
  if (!raw && raw !== "false") return raw;

  if (type === "bool") {
    return raw === "true";
  }

  if (type === "address") {
    return raw.trim();
  }

  if (/^u?int\d*$/.test(type)) {
    // Keep as string for BigNumber compatibility
    return raw.trim();
  }

  if (/^bytes\d*$/.test(type)) {
    return raw.trim();
  }

  if (type === "string") {
    return raw;
  }

  if (type.endsWith("[]") || type === "tuple" || type.startsWith("tuple")) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON for ${type}: ${raw}`);
    }
  }

  return raw;
}

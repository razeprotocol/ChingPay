
import React, { useState, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Loader2, AlertTriangle,
  CheckCircle2, Zap, ArrowRight
} from 'lucide-react';
import { STELLAR_ASSETS, SupportedAsset, findDexRoute, PathQuote } from '../services/pathPaymentService';

interface PathPaymentSelectorProps {
  onRouteSelect: (routeAsset: SupportedAsset, quote: PathQuote | null) => void;
  senderPublicKey: string;
  xlmAmountToSend: string;
  disabled?: boolean;
}

const ASSET_META: Record<SupportedAsset, { color: string; dot: string }> = {
  XLM:  { color: '#E5D5B3', dot: '#D4874D' },
  USDC: { color: '#60a5fa', dot: '#3b82f6' },
  yXLM: { color: '#a78bfa', dot: '#8b5cf6' },
};

const PathPaymentSelector: React.FC<PathPaymentSelectorProps> = ({
  onRouteSelect,
  senderPublicKey,
  xlmAmountToSend,
  disabled = false,
}) => {
  const [selectedAsset, setSelectedAsset] = useState<SupportedAsset>('XLM');
  const [isExpanded, setIsExpanded] = useState(false);
  const [quote, setQuote] = useState<PathQuote | null>(null);
  const [loadingPath, setLoadingPath] = useState(false);
  const [pathError, setPathError] = useState('');

  const fetchRoute = useCallback(async (asset: SupportedAsset) => {
    if (asset === 'XLM') {
      setQuote(null);
      return;
    }
    if (!xlmAmountToSend || parseFloat(xlmAmountToSend) <= 0) {
      setPathError('Enter an amount first.');
      return;
    }

    setLoadingPath(true);
    setPathError('');
    try {
      const result = await findDexRoute(senderPublicKey, xlmAmountToSend, asset);
      if (result.available) {
        setQuote(result);
        setPathError('');
      } else {
        setPathError(result.rateInfo || 'No route available on this network.');
        setQuote(null);
      }
    } catch (err: any) {
      setPathError(err.message || 'Route lookup failed.');
      setQuote(null);
    } finally {
      setLoadingPath(false);
    }
  }, [xlmAmountToSend, senderPublicKey]);

  const handleSelectAsset = (asset: SupportedAsset) => {
    setSelectedAsset(asset);
    setIsExpanded(false);
    fetchRoute(asset);
    onRouteSelect(asset, null); // optimistically clear; parent will get quote via re-call
  };

  const meta = ASSET_META[selectedAsset];
  const isRouted = selectedAsset !== 'XLM';
  const info = STELLAR_ASSETS[selectedAsset];

  return (
    <div className="w-full">
      {/* ── Collapsed trigger ── */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          disabled={disabled}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 border-zinc-100 bg-white hover:border-zinc-200 transition-all group disabled:opacity-40 active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
              style={{ background: `${meta.color}18`, border: `1.5px solid ${meta.color}40` }}
            >
              {info.icon}
            </div>
            <div className="text-left">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-400 mb-0.5">DEX Route</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-black text-zinc-900 tracking-tight">
                  {isRouted ? `via ${info.name}` : 'Direct XLM'}
                </p>
                {isRouted && (
                  <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-zinc-900 text-[#E5D5B3]">
                    DEX
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Status on right */}
          <div className="flex items-center gap-2">
            {isRouted && !isExpanded && (
              loadingPath ? (
                <Loader2 size={12} className="text-zinc-400 animate-spin" />
              ) : quote ? (
                <span className="text-[9px] font-black text-emerald-500">✓ Ready</span>
              ) : pathError ? (
                <AlertTriangle size={12} className="text-rose-400" />
              ) : null
            )}
            <ChevronDown size={15} className="text-zinc-300 group-hover:text-zinc-500 transition-colors" />
          </div>
        </button>
      )}

      {/* ── Active DEX route banner (collapsed + active route) ── */}
      {!isExpanded && isRouted && (
        <div
          className="mt-2 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border"
          style={{ background: `${meta.color}10`, borderColor: `${meta.color}30` }}
        >
          {/* XLM → asset → XLM */}
          <span className="text-[10px] font-black text-zinc-500">XLM</span>
          <ArrowRight size={10} style={{ color: meta.dot }} />
          <span className="text-[10px] font-black" style={{ color: meta.color }}>
            {STELLAR_ASSETS[selectedAsset].code}
          </span>
          <ArrowRight size={10} style={{ color: meta.dot }} />
          <span className="text-[10px] font-black text-zinc-500">XLM</span>

          <div className="ml-auto flex items-center gap-1.5">
            {loadingPath ? (
              <Loader2 size={10} className="text-zinc-400 animate-spin" />
            ) : quote ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: meta.dot }} />
                <span className="text-[9px] font-black" style={{ color: meta.color }}>
                  ~{quote.priceImpact.toFixed(2)}% spread
                </span>
              </>
            ) : pathError ? (
              <span className="text-[9px] font-black text-rose-400">Unavailable</span>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Expanded panel ── */}
      {isExpanded && (
        <div className="w-full rounded-3xl border-2 border-zinc-100 bg-white overflow-hidden shadow-sm">
          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-zinc-100">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                    DEX Route
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 font-medium leading-snug max-w-[220px]">
                  You always pay XLM. Stellar DEX routes atomically through the chosen pool.
                </p>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-900 shrink-0">
                <Zap size={9} className="text-[#E5D5B3]" fill="currentColor" />
                <span className="text-[8px] font-black uppercase tracking-widest text-[#E5D5B3]">Stellar DEX</span>
              </div>
            </div>
          </div>

          {/* Asset list */}
          <div className="p-3 space-y-1.5">
            {(Object.keys(STELLAR_ASSETS) as SupportedAsset[]).map((code) => {
              const isSelected = selectedAsset === code;
              const itemMeta = ASSET_META[code];
              const itemInfo = STELLAR_ASSETS[code];
              const itemIsRouted = code !== 'XLM';

              return (
                <button
                  key={code}
                  onClick={() => handleSelectAsset(code)}
                  className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98] text-left ${
                    isSelected ? 'bg-zinc-950 shadow-lg' : 'bg-zinc-50 hover:bg-zinc-100'
                  }`}
                >
                  {/* Icon */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-sm"
                    style={{
                      background: isSelected ? `${itemMeta.color}22` : '#f4f4f5',
                      border: `1.5px solid ${isSelected ? itemMeta.color + '50' : '#e4e4e7'}`,
                    }}
                  >
                    {itemInfo.icon}
                  </div>

                  {/* Route label */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {itemIsRouted ? (
                        <div className="flex items-center gap-1">
                          <span className={`text-[11px] font-black opacity-40 ${isSelected ? 'text-white' : 'text-zinc-500'}`}>XLM</span>
                          <ArrowRight size={9} style={{ color: isSelected ? itemMeta.color : '#a1a1aa' }} />
                          <span className="text-[13px] font-black tracking-tight" style={{ color: isSelected ? itemMeta.color : '#3f3f46' }}>
                            {itemInfo.code}
                          </span>
                          <ArrowRight size={9} style={{ color: isSelected ? itemMeta.color : '#a1a1aa' }} />
                          <span className={`text-[11px] font-black opacity-40 ${isSelected ? 'text-white' : 'text-zinc-500'}`}>XLM</span>
                        </div>
                      ) : (
                        <p className={`text-[13px] font-black tracking-tight ${isSelected ? 'text-white' : 'text-zinc-800'}`}>
                          Direct XLM
                        </p>
                      )}
                      {itemIsRouted && (
                        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-zinc-800/50 text-zinc-300 ml-auto">
                          via DEX
                        </span>
                      )}
                    </div>
                    {/* Sublabel */}
                    {isSelected && itemIsRouted ? (
                      <div className="flex items-center gap-1.5 h-4 mt-1">
                        {loadingPath ? (
                          <>
                            <Loader2 size={9} className="text-zinc-500 animate-spin" />
                            <span className="text-[9px] text-zinc-500">Scanning {itemInfo.code} pool...</span>
                          </>
                        ) : pathError ? (
                          <>
                            <AlertTriangle size={9} className="text-rose-400" />
                            <span className="text-[9px] text-rose-400">{pathError}</span>
                          </>
                        ) : quote ? (
                          <>
                            <CheckCircle2 size={9} className="text-emerald-400" />
                            <span className="text-[9px] text-emerald-400 font-bold">{quote.rateInfo}</span>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <p className={`text-[9px] font-medium mt-0.5 ${isSelected ? 'text-white/40' : 'text-zinc-400'}`}>
                        {itemInfo.description}
                      </p>
                    )}
                  </div>

                  {/* Radio */}
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      isSelected ? 'border-white/40' : 'border-zinc-200'
                    }`}
                  >
                    {isSelected && (
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: itemMeta.color }} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Info note */}
          <div className="px-4 pb-3">
            <p className="text-[9px] text-zinc-400 text-center leading-relaxed">
              You pay XLM · No extra tokens needed · Atomic swap on Stellar
            </p>
          </div>

          {/* Close */}
          <button
            onClick={() => setIsExpanded(false)}
            className="w-full flex items-center justify-center gap-2 py-3.5 border-t border-zinc-100 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] hover:text-zinc-600 transition-colors"
          >
            <ChevronUp size={12} />
            Close
          </button>
        </div>
      )}
    </div>
  );
};

export default PathPaymentSelector;

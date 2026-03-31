
import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, TrendingUp, TrendingDown, ShoppingBag, Utensils, Car, Zap, Film, BarChart3, ChevronRight, Brain, Loader2 } from 'lucide-react';
import { TransactionRecord } from '../types';
import { getTransactions } from '../services/db';
import { getCurrencySymbol, formatFiat } from '../utils/currency';

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  Shopping:      { icon: <ShoppingBag size={14} />, color: 'text-pink-400', bg: 'bg-pink-500/10' },
  Food:          { icon: <Utensils size={14} />, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  Travel:        { icon: <Car size={14} />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  Bills:         { icon: <Zap size={14} />, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  Entertainment: { icon: <Film size={14} />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  Other:         { icon: <BarChart3 size={14} />, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
  Savings:       { icon: <TrendingUp size={14} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  Withdrawal:    { icon: <TrendingDown size={14} />, color: 'text-amber-400', bg: 'bg-amber-500/10' },
};

interface CategorySummary {
  name: string;
  total: number;
  count: number;
  percent: number;
}

interface SpendingInsightsProps {
  stellarId: string;
  currency?: string;
}

const AI_INSIGHT_TEMPLATES = [
  (top: string, pct: number) => `You're spending ${pct}% on ${top} this month — your highest category. Consider setting a limit.`,
  (top: string, pct: number) => `${top} is taking up ${pct}% of your budget. Try the Gullak round-up on every ${top} payment to save passively!`,
  (top: string, _: number) => `Smart tip: Switch ${top} payments to Chillar mode to automatically save the change.`,
  (top: string, pct: number) => `Your ${top} spending (${pct}%) is above average. Review your recent transactions to spot patterns.`,
];

const SpendingInsights: React.FC<SpendingInsightsProps> = ({ stellarId, currency = 'INR' }) => {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiInsight, setAiInsight] = useState('');
  const [generatingInsight, setGeneratingInsight] = useState(false);
  const [totalSpent, setTotalSpent] = useState(0);
  const [comparedPercent, setComparedPercent] = useState(0);
  const symbol = getCurrencySymbol(currency);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;

    const load = async () => {
      try {
        const txs = await getTransactions(stellarId);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        // Current month sent transactions
        const currentMonth = txs.filter(tx =>
          tx.fromId === stellarId &&
          tx.status === 'SUCCESS' &&
          tx.timestamp?.seconds * 1000 >= monthStart.getTime()
        );

        // Previous month
        const prevMonth = txs.filter(tx =>
          tx.fromId === stellarId &&
          tx.status === 'SUCCESS' &&
          tx.timestamp?.seconds * 1000 >= prevMonthStart.getTime() &&
          tx.timestamp?.seconds * 1000 < monthStart.getTime()
        );

        const totalCurrent = currentMonth.reduce((s, tx) => s + (tx.amount || 0), 0);
        const totalPrev = prevMonth.reduce((s, tx) => s + (tx.amount || 0), 0);

        setTotalSpent(totalCurrent);

        if (totalPrev > 0) {
          const diff = ((totalCurrent - totalPrev) / totalPrev) * 100;
          setComparedPercent(Math.round(diff));
        }

        // Category breakdown
        const catMap: Record<string, { total: number; count: number }> = {};
        currentMonth.forEach(tx => {
          const cat = tx.category || 'Other';
          if (!catMap[cat]) catMap[cat] = { total: 0, count: 0 };
          catMap[cat].total += tx.amount || 0;
          catMap[cat].count += 1;
        });

        const summaries: CategorySummary[] = Object.entries(catMap)
          .map(([name, { total, count }]) => ({
            name,
            total,
            count,
            percent: totalCurrent > 0 ? Math.round((total / totalCurrent) * 100) : 0
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);

        setCategories(summaries);

        // Generate AI insight
        if (summaries.length > 0) {
          setGeneratingInsight(true);
          await new Promise(r => setTimeout(r, 800)); // simulated AI "thinking"
          const top = summaries[0];
          const template = AI_INSIGHT_TEMPLATES[Math.floor(Math.random() * AI_INSIGHT_TEMPLATES.length)];
          setAiInsight(template(top.name, top.percent));
          setGeneratingInsight(false);
        }
      } catch (err) {
        console.error('SpendingInsights error:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [stellarId]);

  if (loading) {
    return (
      <div className="mx-6 mt-6 bg-zinc-900/30 border border-white/5 rounded-3xl p-5 flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-[#E5D5B3]/30 border-t-[#E5D5B3] rounded-full animate-spin" />
      </div>
    );
  }

  if (categories.length === 0) return null;

  const maxTotal = categories[0]?.total || 1;

  return (
    <div className="mx-6 mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-violet-500/15 border border-violet-500/25 rounded-xl flex items-center justify-center">
            <Brain size={14} className="text-violet-400" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/80">AI Spending Insights</span>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
          comparedPercent > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
        }`}>
          {comparedPercent > 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
          {Math.abs(comparedPercent)}% vs last month
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-5 overflow-hidden relative">
        {/* Subtle glow */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/5 blur-2xl rounded-full pointer-events-none" />

        {/* Total this month */}
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-1">This Month</p>
            <p className="text-2xl font-black tracking-tight">
              {symbol}{formatFiat(totalSpent, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Categories</p>
            <p className="text-sm font-black text-zinc-400">{categories.length} active</p>
          </div>
        </div>

        {/* Category Bars */}
        <div className="space-y-3 mb-5">
          {categories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat.name] || CATEGORY_CONFIG['Other'];
            const barWidth = (cat.total / maxTotal) * 100;

            return (
              <div key={cat.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg ${cfg.bg} flex items-center justify-center ${cfg.color}`}>
                      {cfg.icon}
                    </div>
                    <span className="text-[11px] font-bold text-zinc-300">{cat.name}</span>
                    <span className="text-[9px] text-zinc-600 font-bold">{cat.count}x</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-black">{symbol}{formatFiat(cat.total, currency)}</span>
                    <span className="text-[9px] text-zinc-600 font-bold ml-1">{cat.percent}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: `${barWidth}%`,
                      background: cat.name === 'Shopping' ? 'linear-gradient(90deg, #ec4899, #f472b6)'
                        : cat.name === 'Food' ? 'linear-gradient(90deg, #f97316, #fb923c)'
                        : cat.name === 'Travel' ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
                        : cat.name === 'Bills' ? 'linear-gradient(90deg, #eab308, #fbbf24)'
                        : cat.name === 'Entertainment' ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
                        : 'linear-gradient(90deg, #E5D5B3, #D4874D)'
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* AI Insight Box */}
        <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-7 h-7 bg-violet-500/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            {generatingInsight ? (
              <Loader2 size={13} className="text-violet-400 animate-spin" />
            ) : (
              <Sparkles size={13} className="text-violet-400" />
            )}
          </div>
          <p className="text-[11px] text-zinc-300 font-medium leading-relaxed">
            {generatingInsight ? (
              <span className="text-violet-400/60 animate-pulse">Analyzing your spending patterns...</span>
            ) : (
              aiInsight
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SpendingInsights;


import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, TrendingUp, TrendingDown, ShoppingBag, Utensils, Car, Zap, Film, BarChart3, Brain, Loader2 } from 'lucide-react';
import { getTransactions } from '../services/db';
import { getCurrencySymbol, formatFiat } from '../utils/currency';

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; gradient: string }> = {
  Shopping: { icon: <ShoppingBag size={14} />, color: 'text-pink-400', bg: 'bg-pink-500/10', gradient: 'from-pink-500 to-rose-500' },
  Food: { icon: <Utensils size={14} />, color: 'text-orange-400', bg: 'bg-orange-500/10', gradient: 'from-orange-500 to-amber-500' },
  Travel: { icon: <Car size={14} />, color: 'text-blue-400', bg: 'bg-blue-500/10', gradient: 'from-blue-500 to-indigo-500' },
  Bills: { icon: <Zap size={14} />, color: 'text-yellow-400', bg: 'bg-yellow-500/10', gradient: 'from-yellow-500 to-orange-400' },
  Entertainment: { icon: <Film size={14} />, color: 'text-purple-400', bg: 'bg-purple-500/10', gradient: 'from-purple-500 to-violet-500' },
  Other: { icon: <BarChart3 size={14} />, color: 'text-[#E5D5B3]', bg: 'bg-[#E5D5B3]/10', gradient: 'from-[#E5D5B3] to-[#D4874D]' },
  Savings: { icon: <TrendingUp size={14} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', gradient: 'from-emerald-500 to-teal-500' },
  Withdrawal: { icon: <TrendingDown size={14} />, color: 'text-amber-400', bg: 'bg-amber-500/10', gradient: 'from-amber-500 to-orange-600' },
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
  (top: string, pct: number) => `You're spending ${pct}% on ${top} this month. Consider setting a limit to boost your Gullak savings.`,
  (top: string, pct: number) => `${top} accounts for ${pct}% of your budget. Switch to Chillar mode for these to save the change!`,
  (top: string, _: number) => `Smart habit: Enable Gullak round-ups on ${top} payments to passively grow your wealth.`,
  (top: string, pct: number) => `Your ${top} spending is at ${pct}%. Reviewing these could uncover hidden savings potential.`,
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

        const currentMonth = txs.filter(tx =>
          tx.fromId === stellarId &&
          tx.status === 'SUCCESS' &&
          tx.timestamp?.seconds * 1000 >= monthStart.getTime()
        );

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

        if (summaries.length > 0) {
          setGeneratingInsight(true);
          await new Promise(r => setTimeout(r, 1200));
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
      <div className="mx-6 mt-8 animate-pulse">
        <div className="h-6 w-32 bg-zinc-800 rounded-lg mb-4"></div>
        <div className="h-48 bg-zinc-900/50 rounded-3xl border border-white/5"></div>
      </div>
    );
  }

  if (categories.length === 0) return null;

  const maxTotal = categories[0]?.total || 1;

  return (
    <div className="mx- mt-10">
      <div className="flex items-center justify-between mb-5 px-1">
        <div className="flex items-center gap-3">

          <div>
            <span className="text-xs font-black uppercase -[0.2em] text-white/90 block leading-tight">AI Insights</span>
            <span className="text-[10px] text-zinc-500 font-bold uppercase -widest">Spending Analytics</span>
          </div>
        </div>

        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border text-[10px] font-black uppercase -widest transition-all ${comparedPercent > 0
          ? 'bg-rose-500/5 border-rose-500/20 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.05)]'
          : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.05)]'
          }`}>
          {comparedPercent > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(comparedPercent)}% vs LY
        </div>
      </div>

      <div className="relative bg-zinc-900/40 backdrop-blur-md border border-white/5 rounded-[1.5rem] p-7 overflow-hidden shadow-2xl group">
        <div className="absolute top-0 right-0 w-48 h-48 bg-violet-500/10 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-violet-500/15 transition-all duration-700" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-[#E5D5B3]/5 blur-[80px] rounded-full translate-y-1/2 -translate-x-1/2" />

        <div className="flex items-end justify-between mb-8 relative z-10">
          <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase -[0.15em] mb-1.5">MONTHLY OUTFLOW</p>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-black text-[#E5D5B3]">{symbol}</span>
              <h3 className="text-3xl font-black -tighter text-white">
                {formatFiat(totalSpent, currency).split('.')[0]}<span className="text-xl text-zinc-600">.{formatFiat(totalSpent, currency).split('.')[1] || '00'}</span>
              </h3>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-zinc-500 uppercase -[0.15em] mb-1.5">CATEGORIES</p>
            <p className="text-lg font-black text-white">{categories.length} <span className="text-xs text-zinc-600 uppercase">Tracked</span></p>
          </div>
        </div>

        <div className="space-y-5 mb-8 relative z-10">
          {categories.map((cat, idx) => {
            const cfg = CATEGORY_CONFIG[cat.name] || CATEGORY_CONFIG['Other'];
            const barWidth = (cat.total / maxTotal) * 100;

            return (
              <div key={cat.name} className="animate-in fade-in slide-in-from-left duration-700" style={{ animationDelay: `${idx * 150}ms` }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl ${cfg.bg} flex items-center justify-center ${cfg.color} border border-white/5`}>
                      {cfg.icon}
                    </div>
                    <div>
                      <span className="text-xs font-black text-zinc-200 block leading-tight">{cat.name}</span>
                      <span className="text-[9px] text-zinc-600 font-bold uppercase -widest">{cat.count} Payments</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-white">{symbol}{formatFiat(cat.total, currency)}</div>
                    <div className="text-[9px] font-black text-zinc-500 uppercase -tighter mt-0.5">{cat.percent}% share</div>
                  </div>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden p-[2px]">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${cfg.gradient} transition-all duration-1000 shadow-[0_0_8px_rgba(0,0,0,0.5)]`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>


      </div>
    </div>
  );
};

export default SpendingInsights;

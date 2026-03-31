
/**
 * Path Payment Service - Stellar DEX Native Multi-Asset Payments
 *
 * The correct model (no trustline required from sender):
 * - Sender ALWAYS sends XLM (what they have)
 * - The DEX routes THROUGH an intermediary asset (USDC, yXLM, etc.)
 * - Recipient receives XLM at the other end
 * - This demonstrates Stellar's atomic multi-hop DEX routing
 *
 * This is a CORE Stellar-native feature that requires NO trustlines
 * from the sender, only XLM balance.
 */

import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Horizon,
  BASE_FEE,
  Memo,
} from '@stellar/stellar-sdk';
import { getNetworkConfig } from '../context/NetworkContext';

const getServer = () => {
  const config = getNetworkConfig();
  return new Horizon.Server(config.horizonUrl);
};

const getNetworkPassphrase = () => {
  const config = getNetworkConfig();
  return config.networkPassphrase;
};

/** 
 * Well-known Stellar intermediary assets for DEX routing.
 * These are used as the INTERMEDIARY hop in the path, not as source/dest.
 * Sender: XLM → [Intermediary] → XLM: Recipient
 */
export const STELLAR_ASSETS = {
  XLM: {
    code: 'XLM',
    issuer: '',
    name: 'Stellar Lumens',
    icon: '⭐',
    coingeckoId: 'stellar',
    description: 'Direct XLM payment. No DEX conversion.',
  },
  USDC: {
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    name: 'USD Coin',
    icon: '💵',
    coingeckoId: 'usd-coin',
    description: 'Route via USDC liquidity pools for potentially better conversion.',
  },
  yXLM: {
    code: 'yXLM',
    issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
    name: 'yXLM Yield',
    icon: '🌟',
    coingeckoId: 'stellar',
    description: 'Route via yXLM yield pools with atomic DEX swap.',
  },
};

export type SupportedAsset = keyof typeof STELLAR_ASSETS;

/** Return a Stellar Asset object */
export const getAsset = (assetCode: SupportedAsset): Asset => {
  if (assetCode === 'XLM') return Asset.native();
  const info = STELLAR_ASSETS[assetCode];
  return new Asset(info.code, info.issuer);
};

export interface PathQuote {
  /** The intermediary routed through (e.g. USDC) */
  routeAsset: SupportedAsset;
  /** Recipient gets exactly this much XLM */
  destXlmAmount: string;
  /** Sender sends at most this much XLM */
  maxSourceXlm: string;
  /** The raw path returned by Horizon (intermediary hops) */
  path: any[];
  /** Estimated price impact % */
  priceImpact: number;
  /** Whether this route is viable */
  available: boolean;
  /** Human readable rate info */
  rateInfo: string;
}

/**
 * Find the best DEX route for XLM → [intermediary] → XLM.
 * Uses Horizon's strictReceivePaths to find the cheapest XLM source amount
 * to deliver exactly `xlmDestAmount` to the recipient, routed through `routeAsset`.
 *
 * No trustlines needed from sender — all XLM based.
 */
export const findDexRoute = async (
  senderPublicKey: string,
  xlmDestAmount: string,
  routeAsset: SupportedAsset
): Promise<PathQuote> => {
  const server = getServer();
  const xlmAsset = Asset.native();

  const baseQuote: PathQuote = {
    routeAsset,
    destXlmAmount: xlmDestAmount,
    maxSourceXlm: xlmDestAmount,
    path: [],
    priceImpact: 0,
    available: true,
    rateInfo: 'Direct XLM · No conversion fee',
  };

  if (routeAsset === 'XLM') return baseQuote;

  try {
    // Ask Horizon: "to receive exactly xlmDestAmount XLM, 
    // what's the cheapest XLM I can send, routing through routeAsset?"
    const routeAssetObj = getAsset(routeAsset);

    // We want to find: XLM → routeAsset → XLM
    // Use strictReceivePaths: destAsset=XLM, destAmount=xlmDestAmount
    // Source account has XLM. Horizon will find paths through the intermediary.
    const result = await server
      .strictReceivePaths(senderPublicKey, xlmAsset, xlmDestAmount)
      .call();

    // Find a path that routes through our chosen intermediary
    const records = result.records || [];

    // Look for path that goes through routeAsset
    let bestRecord = records.find((r: any) => {
      const pathCodes = (r.path || []).map((p: any) =>
        p.asset_type === 'native' ? 'XLM' : p.asset_code
      );
      return pathCodes.includes(routeAsset === 'yXLM' ? 'yXLM' : STELLAR_ASSETS[routeAsset].code);
    });

    // If no specific path through our asset, take the best overall path
    if (!bestRecord && records.length > 0) {
      bestRecord = records[0];
    }

    if (bestRecord) {
      // source_amount is how much XLM sender needs (could be slightly different from dest if DEX has spread)
      const sourceXlm = parseFloat(bestRecord.source_amount);
      const destXlm = parseFloat(xlmDestAmount);

      // Add 1% slippage buffer to maxSourceAmount
      const maxSourceXlm = (sourceXlm * 1.01).toFixed(7);

      const spread = ((sourceXlm - destXlm) / destXlm) * 100;
      const priceImpact = Math.abs(spread);

      return {
        routeAsset,
        destXlmAmount: xlmDestAmount,
        maxSourceXlm,
        path: bestRecord.path || [],
        priceImpact,
        available: true,
        rateInfo: `Via ${STELLAR_ASSETS[routeAsset].name} · ~${priceImpact.toFixed(2)}% spread`,
      };
    }

    // No DEX path found — mark unavailable
    return {
      ...baseQuote,
      routeAsset,
      available: false,
      rateInfo: 'No DEX route available on this network',
    };
  } catch (err: any) {
    console.error(`[DEX] Route via ${routeAsset} failed:`, err);
    return {
      ...baseQuote,
      routeAsset,
      available: false,
      rateInfo: 'Route unavailable',
    };
  }
};

/**
 * Execute a DEX-routed path payment.
 * Sender ALWAYS pays XLM. DEX routes through intermediary. Recipient gets XLM.
 * No trustlines required by sender.
 *
 * Uses pathPaymentStrictReceive:
 * - sendAsset = XLM
 * - sendMax = maxSourceXlm (with slippage buffer)
 * - destAsset = XLM
 * - destAmount = exact XLM recipient gets
 * - path = intermediary hops from Horizon
 */
export const executeDexRoutePayment = async (
  senderSecret: string,
  recipientPublicKey: string,
  quote: PathQuote,
  memo: string = 'DEX Pay via StellarUpi'
): Promise<string> => {
  const server = getServer();
  const senderKeypair = Keypair.fromSecret(senderSecret);
  const sourceAccount = await server.loadAccount(senderKeypair.publicKey());

  const xlmAsset = Asset.native();

  // Build intermediary path assets
  const pathAssets: Asset[] = (quote.path || []).map((p: any) => {
    if (p.asset_type === 'native') return Asset.native();
    return new Asset(p.asset_code, p.asset_issuer);
  });

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: xlmAsset,          // Always XLM from sender
        sendMax: quote.maxSourceXlm,  // Max XLM sender spends (inc. slippage)
        destination: recipientPublicKey,
        destAsset: xlmAsset,          // Always XLM to recipient
        destAmount: quote.destXlmAmount,
        path: pathAssets,             // DEX hops (e.g. [USDC])
      })
    )
    .addMemo(Memo.text(memo.substring(0, 28)))
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);

  try {
    const result = await server.submitTransaction(transaction);
    return result.hash;
  } catch (error: any) {
    const resultCodes = error.response?.data?.extras?.result_codes;
    const ops = resultCodes?.operations || [];

    if (ops.includes('op_src_no_trust')) {
      throw new Error('Your account does not have a trustline for the source asset. This should not happen with XLM — please try again.');
    }
    if (ops.includes('op_no_path')) {
      throw new Error('No DEX path found for this route. The liquidity pool may be empty. Try a direct XLM payment instead.');
    }
    if (ops.includes('op_over_source_max')) {
      throw new Error('Slippage exceeded. Market moved too fast. Try again or use Direct XLM.');
    }
    if (ops.includes('op_underfunded')) {
      throw new Error('Insufficient XLM balance to complete this DEX payment.');
    }
    if (ops.includes('op_no_destination')) {
      throw new Error('Recipient account not found on this network.');
    }

    console.error('[DEX] Submission error:', resultCodes);
    throw new Error(
      resultCodes?.operations?.[0]
        ? `Transaction failed: ${resultCodes.operations[0]}`
        : 'DEX payment failed. Please try again.'
    );
  }
};

// ── Legacy exports kept for backward compat ──────────────────────────────────

export const findBestRateStrict = async (
  sourceAsset: SupportedAsset,
  destAsset: SupportedAsset,
  sourceAmount: string,
  destPublicKey: string
): Promise<{ destAmount: string; path: any[]; priceImpact: number } | null> => {
  const server = getServer();
  try {
    const sourceAssetObj = getAsset(sourceAsset);
    const destAssetObj = getAsset(destAsset);
    const result = await server
      .strictSendPaths(sourceAssetObj, sourceAmount, [destAssetObj])
      .call();
    if (result.records && result.records.length > 0) {
      const best = result.records[0];
      const sourceAmt = parseFloat(sourceAmount);
      const destAmt = parseFloat(best.destination_amount);
      const priceImpact = sourceAmt > 0 ? Math.abs((sourceAmt - destAmt) / sourceAmt) * 100 : 0;
      return { destAmount: best.destination_amount, path: best.path || [], priceImpact: Math.min(priceImpact, 99) };
    }
    return null;
  } catch { return null; }
};

export const getAssetBalances = async (publicKey: string): Promise<Array<{ code: string; issuer: string; balance: string; limit: string; }>> => {
  const server = getServer();
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances
      .filter(b => b.asset_type !== 'native')
      .map((b: any) => ({ code: b.asset_code, issuer: b.asset_issuer, balance: b.balance, limit: b.limit }));
  } catch { return []; }
};

export const executePathPayment = async (
  senderSecret: string,
  recipientPublicKey: string,
  sourceAsset: SupportedAsset,
  destAsset: SupportedAsset,
  destAmount: string,
  maxSourceAmount: string,
  intermediaryPath: any[] = [],
  memo: string = 'Path Pay via StellarUpi'
): Promise<string> => {
  const quote: PathQuote = {
    routeAsset: sourceAsset,
    destXlmAmount: destAmount,
    maxSourceXlm: maxSourceAmount,
    path: intermediaryPath,
    priceImpact: 0,
    available: true,
    rateInfo: '',
  };
  return executeDexRoutePayment(senderSecret, recipientPublicKey, quote, memo);
};

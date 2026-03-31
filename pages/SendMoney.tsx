
import React, { useState, useEffect } from 'react';
import { UserProfile, FamilyMember, TransactionRecord } from '../types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Send, Search, Wallet, Shield, Zap, ChevronRight, Users, Smartphone, Share2, BadgeIndianRupee, PiggyBank, Check, EyeOff, ArrowLeftRight } from 'lucide-react';
import { getUsersByPhones, getUserById, recordTransaction, getTransactions, updateFamilySpend, getProfile, getProfileByStellarId, getProfileByPublicKey, updatePersonalSpend, updateSplitPayment, updateRequestStatus } from '../services/db';
import { sendPayment, getBalance } from '../services/stellar';
import { getLivePrice, calculateCryptoToSend } from '../services/priceService';
import { decryptSecret } from '../services/encryption';
import { KYCService } from '../services/kycService';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import SuccessScreen from '../components/SuccessScreen';
import UpiDrawer from '../components/UpiDrawer';
import { NotificationService } from '../services/notification';
import { getAvatarUrl } from '../services/avatars';
import { ZKProofService, PaymentProof } from '../services/zkProofService';
import { createViralPayment } from '../services/claimableBalanceService';
import { calculateChillarAmount } from '../utils/chillar';
import { sendChillarPayment } from '../services/stellar';
import { updateStreak, recordGullakDeposit } from '../services/db';
import { PasskeyService } from '../services/passkeyService';
import { Fingerprint, Loader2 } from 'lucide-react';
import StreakFire from '../components/StreakFire';
import { WalletConnectService } from '../services/walletConnectService';
import { getCurrencySymbol, formatFiat } from '../utils/currency';
import { LiquidationService, SANDBOX_BRIDGE_ADDRESS } from '../services/liquidationService';
import { isAccountFunded } from '../services/stellar';
import PathPaymentSelector from '../components/PathPaymentSelector';
import { SupportedAsset, executeDexRoutePayment, PathQuote, STELLAR_ASSETS } from '../services/pathPaymentService';

interface Props {
  profile: UserProfile | null;
}

interface Contact {
  id: string;
  name: string;
  avatarSeed?: string;
}

interface FamilyWalletInfo {
  permission: FamilyMember;
  ownerProfile: UserProfile;
  ownerBalance: string;
}

const SendMoney: React.FC<Props> = ({ profile }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const splitId = searchParams.get('splitId');
  const requestId = searchParams.get('requestId');

  const [searchQuery, setSearchQuery] = useState('');
  const [recentContacts, setRecentContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(true);

  const [walletBalance, setWalletBalance] = useState<string>('0.00');
  // Changed from single FamilyWalletInfo to array to support multiple families
  const [familyWallets, setFamilyWallets] = useState<FamilyWalletInfo[]>([]);
  const [selectedFamilyIndex, setSelectedFamilyIndex] = useState<number>(0);
  const [loadingBalances, setLoadingBalances] = useState(true);

  const [amount, setAmount] = useState(searchParams.get('amt') || '');
  const [memo, setMemo] = useState(searchParams.get('note') || '');
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'family'>('wallet');
  const [loading, setLoading] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const isEthereumMode = searchParams.get('mode') === 'ethereum';
  const ethAddress = searchParams.get('to') || '';
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isUpiDrawerOpen, setIsUpiDrawerOpen] = useState(false);
  const [upiInput, setUpiInput] = useState('');
  const [category, setCategory] = useState<TransactionRecord['category']>('Other');
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [zkProof, setZkProof] = useState<PaymentProof | null>(null);
  const [generatingProof, setGeneratingProof] = useState(false);
  const [isViralLinkMode, setIsViralLinkMode] = useState(false);
  const [claimLink, setClaimLink] = useState<string | null>(null);
  const [chillarSavings, setChillarSavings] = useState(0);
  const [chillarEnabled, setChillarEnabled] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [payoutId, setPayoutId] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<string | undefined>();
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [selectedAsset, setSelectedAsset] = useState<SupportedAsset>('XLM');
  const [xlmRate, setXlmRate] = useState<number>(15.02);
  // Path Payment (Multi-Asset via Stellar DEX)
  const [isPathPayment, setIsPathPayment] = useState(false);
  const [dexQuote, setDexQuote] = useState<PathQuote | null>(null);
  const [dexRouteAsset, setDexRouteAsset] = useState<SupportedAsset>('XLM');

  const [onStellarContacts, setOnStellarContacts] = useState<Contact[]>([]);
  const [inviteContacts, setInviteContacts] = useState<{ name: string, phone: string }[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Freighter WalletConnect state
  const [showFreighterModal, setShowFreighterModal] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcStatus, setWcStatus] = useState<'idle' | 'pairing' | 'connected' | 'requesting' | 'done' | 'error'>('idle');
  const [wcSender, setWcSender] = useState('');
  const [wcError, setWcError] = useState('');

  useEffect(() => {
    const loadBalances = async () => {
      if (!profile) return;
      try {
        const balance = await getBalance(profile.publicKey);
        setWalletBalance(balance);

        // Fetch rates
        const currency = profile?.preferredCurrency || 'INR';
        const xRate = await getLivePrice('stellar', currency);
        setXlmRate(xRate);

        // Fetch ALL family memberships for this user
        const q = query(collection(db, 'family'), where('uid', '==', profile.uid), where('active', '==', true));
        const snap = await getDocs(q);

        if (!snap.empty) {
          // Process ALL family memberships, not just the first one
          const familyPromises = snap.docs.map(async (docSnap) => {
            const permission = { id: docSnap.id, ...docSnap.data() } as FamilyMember;
            const ownerUid = (permission as any).ownerUid;
            const ownerProfile = await getProfile(ownerUid);

            if (ownerProfile) {
              const ownerBalance = await getBalance(ownerProfile.publicKey);
              return { permission, ownerProfile, ownerBalance };
            }
            return null;
          });

          const results = await Promise.all(familyPromises);
          const validFamilies = results.filter((f): f is FamilyWalletInfo => f !== null);
          setFamilyWallets(validFamilies);
        }
      } catch (err) {
        console.error('Error loading balances:', err);
      } finally {
        setLoadingBalances(false);
      }
    };
    loadBalances();
  }, [profile]);

  useEffect(() => {
    const loadContacts = async () => {
      if (!profile) return;
      try {
        const txs = await getTransactions(profile.stellarId);
        const uniqueIds = Array.from(new Set(txs.map(tx =>
          tx.fromId === profile.stellarId ? tx.toId : tx.fromId
        ))).filter(id => id !== profile.stellarId).slice(0, 10);

        const contactProfiles = await Promise.all(uniqueIds.map(async (id) => {
          const p = await getProfileByStellarId(id);
          return {
            id,
            name: p?.displayName || id.split('@')[0],
            avatarSeed: p?.avatarSeed || id
          };
        }));

        setRecentContacts(contactProfiles);
      } catch (err) {
        console.error('Error loading contacts:', err);
      } finally {
        setLoadingContacts(false);
      }
    };
    loadContacts();

    const loadTarget = async () => {
      const toParam = searchParams.get('to');
      const pnParam = searchParams.get('pn');
      const modeParam = searchParams.get('mode');

      if (toParam) {
        if (modeParam === 'upi') {
          // It's an external UPI QR code
          setSelectedContact({
            id: toParam,
            name: pnParam || toParam.split('@')[0],
            avatarSeed: toParam
          });
          return;
        }

        // Check if it's a raw Stellar public key (G... 56 chars)
        const isRawPubKey = toParam.startsWith('G') && toParam.length === 56;

        if (isRawPubKey) {
          // Try to resolve the name from the public key
          const profileByKey = await getProfileByPublicKey(toParam);
          setSelectedContact({
            id: toParam,
            name: profileByKey?.displayName || `${toParam.substring(0, 6)}...${toParam.slice(-4)}`,
            avatarSeed: profileByKey?.avatarSeed || toParam
          });
          return;
        }

        const p = await getProfileByStellarId(toParam);
        setSelectedContact({
          id: toParam,
          name: p?.displayName || toParam.split('@')[0],
          avatarSeed: p?.avatarSeed || toParam
        });
      }
    };
    loadTarget();

    // Load cached contacts for "Full Access" feel
    const cachedStellar = localStorage.getItem('synced_stellar');
    const cachedInvite = localStorage.getItem('invite_list');
    if (cachedStellar) setOnStellarContacts(JSON.parse(cachedStellar));
    if (cachedInvite) setInviteContacts(JSON.parse(cachedInvite));
  }, [profile, searchParams]);

  const syncContacts = async () => {
    if (!('contacts' in navigator && 'select' in (navigator as any).contacts)) {
      setError("Contact Picker API not supported on this browser. Try Android Chrome.");
      return;
    }

    try {
      setSyncing(true);
      const props = ['name', 'tel'];
      const opts = { multiple: true };
      const contacts = await (navigator as any).contacts.select(props, opts);

      if (contacts.length > 0) {
        // Normalize phone number: strip spaces, dashes, parens, +91, leading 0
        const normalizePhone = (phone: string): string => {
          let clean = phone.replace(/[\s\-\(\)]/g, '');
          if (clean.startsWith('+91')) clean = clean.slice(3);
          if (clean.startsWith('91') && clean.length === 12) clean = clean.slice(2);
          if (clean.startsWith('0') && clean.length === 11) clean = clean.slice(1);
          return clean;
        };

        const phoneMap: { [key: string]: string } = {};
        const cleanedPhones: string[] = [];

        contacts.forEach((c: any) => {
          if (!c.tel || c.tel.length === 0) return;
          // Check all phone numbers for each contact
          c.tel.forEach((tel: string) => {
            const normalized = normalizePhone(tel);
            if (normalized.length >= 10) {
              phoneMap[normalized] = c.name?.[0] || 'Unknown';
              cleanedPhones.push(normalized);
            }
          });
        });

        // Remove duplicates
        const uniquePhones = [...new Set(cleanedPhones)];

        const matchedUsers = await getUsersByPhones(uniquePhones);
        const matchedPhones = new Set(matchedUsers.map(u => normalizePhone(u.phoneNumber || '')));

        const stellarContacts = matchedUsers.map(u => ({
          id: u.stellarId,
          name: u.displayName || u.stellarId.split('@')[0],
          avatarSeed: u.avatarSeed || u.stellarId
        }));

        const inviteList = contacts
          .filter((c: any) => {
            if (!c.tel || c.tel.length === 0) return false;
            // Check if ANY of the contact's phone numbers match
            return !c.tel.some((tel: string) => matchedPhones.has(normalizePhone(tel)));
          })
          .map((c: any) => ({
            name: c.name?.[0] || 'Unknown',
            phone: c.tel[0]
          }));

        setOnStellarContacts(stellarContacts);
        setInviteContacts(inviteList);

        localStorage.setItem('synced_stellar', JSON.stringify(stellarContacts));
        localStorage.setItem('invite_list', JSON.stringify(inviteList));
      }
    } catch (err) {
      console.error("Contact sync failed", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleInvite = (name: string) => {
    const message = `Hey ${name}! Join me on Ching Pay to send and receive money instantly: https://stellar.netlify.app`;
    if (navigator.share) {
      navigator.share({
        title: 'Join Ching Pay',
        text: message,
        url: 'https://stellar.netlify.app'
      });
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`);
    }
  };

  const filteredContacts = recentContacts.filter(contact =>
    contact.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currency = profile?.preferredCurrency || 'INR';
  const symbol = getCurrencySymbol(currency);

  const cryptoToInrRaw = (amount: string) => parseFloat(amount) * xlmRate;
  const cryptoToInr = (amount: string) => formatFiat(cryptoToInrRaw(amount), currency);

  const xlmToInrRaw = (xlm: string) => parseFloat(xlm) * xlmRate;
  const xlmToInr = (xlm: string) => formatFiat(xlmToInrRaw(xlm), currency);

  // Get the currently selected family wallet
  const selectedFamilyWallet = familyWallets[selectedFamilyIndex] || null;

  const getFamilyRemainingLimit = (wallet: FamilyWalletInfo | null) => {
    if (!wallet) return 0;
    return wallet.permission.dailyLimit - wallet.permission.spentToday;
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedContact) return;

    // BIOMETRIC FLOW (Passkey)
    if (profile.passkeyEnabled && !showPinModal) {
      setAuthenticating(true);
      try {
        const authSuccess = await PasskeyService.authenticatePasskey(profile);
        if (authSuccess) {
          await executePayment();
          return;
        }
      } catch (err: any) {
        console.error("Biometric auth failed", err);
        // Fallback to PIN
      } finally {
        setAuthenticating(false);
      }
    }

    // If PIN is set, show PIN modal first
    if (profile.pin && !showPinModal) {
      setShowPinModal(true);
      return;
    }

    await executePayment();
  };

  const executePayment = async () => {
    if (!profile || !selectedContact) return;
    setLoading(true);
    setError('');

    const amtNum = parseFloat(amount);
    const phone = localStorage.getItem('ching_phone') || '';
    const currentPin = profile.pin || '0000';

    try {
      let recipientPubKey = '';
      const isInternalStellar = selectedContact.id.endsWith('@stellar');
      const isRawPubKey = selectedContact.id.startsWith('G') && selectedContact.id.length === 56;

      if (isRawPubKey) {
        // Raw Stellar public key (e.g. from URL ?to=GXXX...)
        recipientPubKey = selectedContact.id;
      } else if (isInternalStellar) {
        const recipient = await getUserById(selectedContact.id);
        if (!recipient) throw new Error("Recipient ID not found");
        recipientPubKey = recipient.publicKey;
      } else {
        // External UPI Merchant - Use the Liquidation Bridge
        recipientPubKey = SANDBOX_BRIDGE_ADDRESS;
      }

      if (paymentMethod === 'family' && selectedFamilyWallet) {
        if (amtNum > getFamilyRemainingLimit(selectedFamilyWallet)) throw new Error("Exceeds daily spending limit");

        let ownerSecret: string = '';

        // Strategy 1: Use the shared secret encrypted for this member
        if ((selectedFamilyWallet.permission as any).sharedSecret) {
          // Try with normalized UID (lowercase)
          ownerSecret = decryptSecret((selectedFamilyWallet.permission as any).sharedSecret, profile.uid.toLowerCase());

          // Fallback Strategy: Try without lowercase just in case
          if (!ownerSecret || !ownerSecret.startsWith('S')) {
            ownerSecret = decryptSecret((selectedFamilyWallet.permission as any).sharedSecret, profile.uid);
          }
        }

        // Strategy 2: If sharedSecret is missing or decryption failed, try "Smart Decryption"
        // This only works if the owner has specifically enabled it or if the member is also the owner
        if (!ownerSecret || !ownerSecret.startsWith('S')) {
          // If the spender is the owner, they can decrypt their own secret using their phone and PIN
          if (selectedFamilyWallet.ownerProfile.uid === profile.uid) {
            let vaultKey = KYCService.deriveEncryptionKey(phone, pin || profile.pin || '0000');
            ownerSecret = decryptSecret(selectedFamilyWallet.ownerProfile.encryptedSecret, vaultKey);

            // One last fallback for owner to '0000'
            if (!ownerSecret || !ownerSecret.startsWith('S')) {
              const fallbackKey = KYCService.deriveEncryptionKey(phone, '0000');
              ownerSecret = decryptSecret(selectedFamilyWallet.ownerProfile.encryptedSecret, fallbackKey);
            }
          }
        }

        if (!ownerSecret || !ownerSecret.startsWith('S')) {
          throw new Error("Family authorization failed. The owner may need to re-authorize your access (try removing and re-adding the member) or your session is out of sync.");
        }

        // Apply buffer for merchant/family stability
        let hash = '';
        let pId = '';

        if (!isInternalStellar) {
          setStatusMessage('Getting Liquidation Quote...');
          const quote = await LiquidationService.getQuote(amtNum);

          setStatusMessage('Sending XLM to Bridge...');
          const result = await LiquidationService.executeDirectLiquidation(ownerSecret, selectedContact.id, quote);
          hash = result.txHash;

          setStatusMessage('Triggering UPI Payout...');
          pId = result.payoutId;
          setPayoutId(pId);
        } else {
          setStatusMessage('Sending Payment...');
          const xlmAmount = await calculateCryptoToSend(amtNum, 'stellar', currency, 1.02);
          hash = await sendPayment(ownerSecret, recipientPubKey, xlmAmount.toString(), `FamilyPay: ${selectedContact.id}`);
        }
        setTxHash(hash);

        // Generate ZK Proof for Family Payment (if Incognito is ON)
        if (isIncognito) {
          setGeneratingProof(true);
          try {
            const proof = await ZKProofService.generateProofOfPayment(
              ownerSecret,
              hash,
              amtNum.toString(),
              selectedContact.id
            );
            await ZKProofService.triggerUPIPayout(proof);
            setZkProof(proof);
          } catch (zkErr) {
            console.error("ZK Proof failed:", zkErr);
          } finally {
            setGeneratingProof(false);
          }
        }

        await updateFamilySpend(selectedFamilyWallet.permission.id, amtNum);
        await recordTransaction({
          fromId: selectedFamilyWallet.ownerProfile.stellarId,
          toId: selectedContact.id,
          fromName: selectedFamilyWallet.ownerProfile.displayName || selectedFamilyWallet.ownerProfile.stellarId,
          toName: selectedContact.name,
          amount: amtNum,
          currency: 'INR',
          status: 'SUCCESS',
          txHash: hash,
          isFamilySpend: true,
          spenderId: profile.stellarId,
          category: category,
          isIncognito: isIncognito
        });

        // Trigger in-app notification
        NotificationService.sendInAppNotification(
          selectedContact.id,
          amtNum.toString(),
          selectedFamilyWallet.ownerProfile.displayName || selectedFamilyWallet.ownerProfile.stellarId.split('@')[0]
        );
        // End Family Payment
      } else {
        if (profile.dailyLimit && profile.dailyLimit > 0) {
          const remaining = Math.max(0, profile.dailyLimit - (profile.spentToday || 0));
          if (amtNum > remaining) {
            throw new Error(`Exceeds daily spending limit. Remaining: ${symbol}${remaining}`);
          }
        }

        // Strategy: Try current PIN first, then fallback to '0000' 
        // Handles cases where vault was NEVER re-keyed after setting a PIN.
        let password = KYCService.deriveEncryptionKey(phone, currentPin);
        let secret = decryptSecret(profile.encryptedSecret, password);

        // Fallback to default if current fails
        if ((!secret || !secret.startsWith('S')) && currentPin !== '0000') {
          console.log("[Vault] Primary key failed. Trying legacy '0000' fallback...");
          const fallbackPassword = KYCService.deriveEncryptionKey(phone, '0000');
          secret = decryptSecret(profile.encryptedSecret, fallbackPassword);
        }

        if (!secret || !secret.startsWith('S')) {
          throw new Error("Unable to access Stellar Vault. Your session may have expired or your PIN is out of sync. Please log out and back in once.");
        }

        let hash = '';
        let pId = '';
        let recordedChillar = 0;

        if (!isInternalStellar) {
          // DIRECT UPI LIQUIDATION (No Chillar support for external UPI for now to keep it simple)
          setStatusMessage('Getting Liquidation Quote...');
          const quote = await LiquidationService.getQuote(amtNum);

          setStatusMessage('Sending XLM to Bridge...');
          const result = await LiquidationService.executeDirectLiquidation(secret, selectedContact.id, quote);
          hash = result.txHash;

          setStatusMessage('Triggering UPI Payout...');
          pId = result.payoutId;
          setPayoutId(pId);
        } else if (chillarEnabled) {
          setStatusMessage('Atomic Transfer Initiated...');
          // Calculate Chillar (Round-up)
          const chillarAmount = calculateChillarAmount(amtNum);
          setChillarSavings(chillarAmount);
          recordedChillar = chillarAmount;

          // Convert amounts to XLM
          const xlmAmountMain = await calculateCryptoToSend(amtNum, 'stellar', currency, 1.02);
          const xlmAmountChillar = await calculateCryptoToSend(chillarAmount, 'stellar', currency, 1.02);

          // Check if recipient is new and amount is too low for activation (1 XLM)
          if (parseFloat(xlmAmountMain.toString()) < 1.0) {
            const recipientExists = await isAccountFunded(recipientPubKey).catch(() => true);
            if (!recipientExists) {
              throw new Error(`Recipient is a new user and requires at least ${symbol}${Math.ceil(20 * (xlmRate / 15))} worth of XLM to activate their account. Please increase the amount or send to a funded wallet.`);
            }
          }

          const gullakPk = profile.gullakPublicKey || profile.publicKey;

          hash = await sendChillarPayment(
            secret,
            recipientPubKey,
            gullakPk,
            xlmAmountMain.toString(),
            xlmAmountChillar.toString(),
            memo || `UPI Pay + Chillar: ${selectedContact.id}`
          );

          await updateStreak(profile.uid);
          await recordGullakDeposit(profile.uid, chillarAmount);
        } else if (isPathPayment && dexQuote && dexRouteAsset !== 'XLM') {
          // ─── DEX ROUTE PAYMENT via Stellar ───
          // Sender always pays XLM, DEX routes through chosen asset atomically.
          // No trustline needed. No op_src_no_trust possible.
          setStatusMessage('Executing DEX Route...');
          const xlmAmount = await calculateCryptoToSend(amtNum, 'stellar', currency, 1.02);

          // Refresh the quote with exact XLM amount
          const finalQuote = {
            ...dexQuote,
            destXlmAmount: xlmAmount.toFixed(7),
            maxSourceXlm: (xlmAmount * 1.02).toFixed(7), // 2% slippage
          };

          hash = await executeDexRoutePayment(
            secret,
            recipientPubKey,
            finalQuote,
            memo || `DEX via ${STELLAR_ASSETS[dexRouteAsset].code}: ${selectedContact.id}`
          );
        } else {
          setChillarSavings(0);
          const xlmAmount = await calculateCryptoToSend(amtNum, 'stellar', currency, 1.02);
          hash = await sendPayment(secret, recipientPubKey, xlmAmount.toString(), memo || `UPI Pay: ${selectedContact.id}`);
        }

        setTxHash(hash);

        // Generate ZK Proof of Payment (if Incognito is ON)
        if (isIncognito) {
          setGeneratingProof(true);
          try {
            const proof = await ZKProofService.generateProofOfPayment(
              secret,
              hash,
              amtNum.toString(),
              selectedContact.id
            );

            // Trigger SDK Payout Verification
            await ZKProofService.triggerUPIPayout(proof);
            setZkProof(proof);
          } catch (zkErr) {
            console.error("ZK Proof failed:", zkErr);
            // Don't fail the whole TX if ZK proof fails, but maybe log it
          } finally {
            setGeneratingProof(false);
          }
        }

        await updatePersonalSpend(profile.uid, amtNum);

        await recordTransaction({
          fromId: profile.stellarId,
          toId: selectedContact.id,
          fromName: profile.displayName || profile.stellarId,
          toName: selectedContact.name,
          amount: amtNum,
          currency: 'INR',
          status: 'SUCCESS',
          txHash: hash,
          isFamilySpend: false,
          asset: 'XLM' as 'XLM',
          blockchainNetwork: isEthereumMode ? 'ETHEREUM' : 'STELLAR',
          category: category,
          isIncognito: isIncognito,
          chillarAmount: recordedChillar
        });

        // Record Chillar as a separate small internal record or just part of this?
        // Let's just keep it linked to this TX hash.

        // Trigger in-app notification
        NotificationService.sendInAppNotification(
          selectedContact.id,
          "Payment Received",
          `You received ${symbol}${amtNum} from ${profile.displayName || profile.stellarId.split('@')[0]}`,
          'payment'
        );
      }

      // Handle Split/Request updates
      if (splitId) {
        await updateSplitPayment(splitId, profile.stellarId);
      }
      if (requestId) {
        await updateRequestStatus(requestId, 'PAID');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Payment failed");
      setPin(''); // Reset PIN on error
      setShowPinModal(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === profile?.pin) {
      setShowPinModal(false);
      executePayment();
    } else {
      setError("Incorrect Transaction PIN");
      setPin('');
    }
  };

  // ─── Freighter WalletConnect Send ───
  const handleFreighterSend = async () => {
    if (!profile || !selectedContact || !amount) return;
    setShowFreighterModal(true);
    setWcStatus('pairing');
    setWcError('');

    try {
      // Resolve recipient's public key
      let recipientPubKey = '';
      const isInternal = selectedContact.id.endsWith('@stellar');
      const isRawPubKey = selectedContact.id.startsWith('G') && selectedContact.id.length === 56;

      if (isRawPubKey) {
        // Raw Stellar public key (e.g. from URL ?to=GXXX...)
        recipientPubKey = selectedContact.id;
      } else if (isInternal) {
        const recipient = await getUserById(selectedContact.id);
        if (!recipient) throw new Error('Recipient not found');
        recipientPubKey = recipient.publicKey;
      } else {
        throw new Error('Freighter only supports Stellar recipients');
      }

      // Create WalletConnect pairing
      const { uri, approval } = await WalletConnectService.createPairing();
      setWcUri(uri);

      // Wait for Freighter to scan and approve
      const senderAddress = await WalletConnectService.waitForSession(approval);
      setWcSender(senderAddress);
      setWcStatus('requesting');

      // Immediately request payment
      const txHash = await WalletConnectService.requestPayment({
        recipientPublicKey: recipientPubKey,
        amount,
        memo: memo || `Pay ${selectedContact.name}`
      });

      // Record transaction
      await recordTransaction({
        fromId: senderAddress.substring(0, 10) + '@stellar',
        toId: selectedContact.id,
        fromName: 'Freighter Wallet',
        toName: selectedContact.name,
        amount: parseFloat(amount),
        currency: 'XLM',
        status: 'SUCCESS',
        memo: memo || 'Freighter Payment',
        txHash,
        isFamilySpend: false,
        category
      });

      NotificationService.sendInAppNotification(
        selectedContact.id,
        'Payment Received',
        `Received ${amount} XLM from Freighter wallet`,
        'payment'
      );

      setWcStatus('done');
      setTimeout(() => WalletConnectService.disconnect(), 3000);
    } catch (e: any) {
      console.error('Freighter send error:', e);
      setWcError(e.message || 'Freighter payment failed');
      setWcStatus('error');
    }
  };

  const closeFreighterModal = () => {
    setShowFreighterModal(false);
    setWcUri(null);
    setWcStatus('idle');
    setWcSender('');
    setWcError('');
    if (wcStatus === 'done') {
      setSuccess(true);
    }
    WalletConnectService.disconnect();
  };

  if (success) {
    return (
      <SuccessScreen
        recipientName={selectedContact?.name || ''}
        recipientAvatar={selectedContact?.avatarSeed || selectedContact?.id}
        amount={amount}
        txHash={txHash}
        zkProof={zkProof}
        claimLink={claimLink}
        chillarAmount={chillarSavings}
        payoutId={payoutId}
        upiId={selectedContact?.id}
        currency={profile.preferredCurrency || 'INR'}
      />
    );
  }

  if (selectedContact) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a0f0a] via-[#0d1210] to-[#0a0f0a] flex flex-col relative overflow-hidden text-white">
        {/* PIN Modal Overlay */}
        {showPinModal && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-8">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-xl" onClick={() => setShowPinModal(false)}></div>
            <div className="relative w-full max-w-sm flex flex-col items-center animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-[#E5D5B3]/10 rounded-2xl flex items-center justify-center text-[#E5D5B3] mb-8 border border-[#E5D5B3]/20">
                <Shield size={32} />
              </div>
              <h3 className="text-2xl font-black mb-2 tracking-tight">Security Check</h3>
              <p className="text-zinc-500 text-sm font-medium mb-12 uppercase tracking-widest">Enter Transaction PIN</p>

              <div className="flex gap-4 mb-12">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${pin.length > i ? 'bg-[#E5D5B3] border-[#E5D5B3] scale-125 shadow-[0_0_15px_rgba(229,213,179,0.5)]' : 'border-zinc-800'}`}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-6 w-full max-w-[280px]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, profile?.passkeyEnabled ? 'bio' : '', 0, 'del'].map((num, i) => (
                  <button
                    key={i}
                    onClick={async () => {
                      if (num === 'bio') {
                        setAuthenticating(true);
                        try {
                          const success = await PasskeyService.authenticatePasskey(profile!);
                          if (success) {
                            setShowPinModal(false);
                            executePayment();
                          }
                        } catch (err) {
                          console.error(err);
                        } finally {
                          setAuthenticating(false);
                        }
                        return;
                      }

                      if (num === 'del') setPin(pin.slice(0, -1));
                      else if (num !== '' && pin.length < 4) {
                        const newPin = pin + num;
                        setPin(newPin);
                        if (newPin.length === 4 && newPin === profile?.pin) {
                          setShowPinModal(false);
                          setTimeout(() => executePayment(), 300);
                        } else if (newPin.length === 4) {
                          setError("Incorrect Transaction PIN");
                          setTimeout(() => setPin(''), 500);
                        }
                      }
                    }}
                    className={`h-16 rounded-2xl flex items-center justify-center text-xl font-black transition-all ${num === '' ? 'pointer-events-none' : 'hover:bg-white/5 active:scale-90 border border-transparent active:border-white/10'}`}
                  >
                    {num === 'del' ? '←' : num === 'bio' ? <Fingerprint className="text-[#E5D5B3]" /> : num}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowPinModal(false)}
                className="mt-12 text-zinc-600 font-bold uppercase tracking-widest text-[10px] hover:text-white transition-colors"
              >
                Cancel Payment
              </button>
            </div>
          </div>
        )}
        <div className="absolute top-[-10%] right-[-10%] w-[80%] h-[40%] bg-[#E5D5B3]/5 rounded-full blur-[100px]"></div>

        <div className="relative z-20 pt-5 px-6 flex items-center justify-between">
          <button
            onClick={() => {
              setSelectedContact(null);
              setIsViralLinkMode(false);
              setClaimLink(null);
              // If we were in ethereum mode, clear search params too maybe? 
              // But navigate will clear them if we go back
            }}
            className="p-3 bg-zinc-900/80 backdrop-blur-md rounded-2xl text-zinc-400 hover:text-white transition-all border border-white/5"
          >
            <ArrowLeft size={20} />
          </button>

          <div
            onClick={() => setIsIncognito(!isIncognito)}
            className="flex items-center gap-3 cursor-pointer select-none"
          >
            <span className={`text-[10px] font-black uppercase tracking-widest transition-colors duration-300 ${isIncognito ? 'text-[#E5D5B3]' : 'text-zinc-600'}`}>
              Incognito
            </span>
            <div
              style={{
                width: '44px',
                height: '26px',
                borderRadius: '13px',
                padding: '2px',
                backgroundColor: isIncognito ? '#E5D5B3' : '#39393D',
                transition: 'background-color 0.3s ease',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '11px',
                  backgroundColor: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
                  transform: isIncognito ? 'translateX(18px)' : 'translateX(0px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <EyeOff size={12} style={{ color: isIncognito ? '#E5D5B3' : '#999' }} />
              </div>
            </div>
          </div>
        </div>

        {isEthereumMode && (
          <div className="mx-6 mt-4 p-4 bg-orange-500/10 border border-orange-500/20 rounded-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center">
              <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Mirror_Logo.svg" className="w-7 h-7" alt="MetaMask" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-white">Ethereum Address</p>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest truncate">{ethAddress}</p>
            </div>
          </div>
        )}

        <div className="relative z-10 flex-1 flex flex-col items-center pt-2 px-6 text-white">
          <div className="flex flex-col items-center mb-10 text-center">
            <div className="w-24 h-24 rounded-[2rem] bg-zinc-900 border-2 border-white/5 overflow-hidden shadow-2xl mb-4">
              <img
                src={getAvatarUrl(selectedContact.avatarSeed || selectedContact.id)}
                alt={selectedContact.name}
                className="w-full h-full object-cover"
              />
            </div>
            <h2 className="text-2xl font-black tracking-tight capitalize">{selectedContact.name}</h2>
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1 opacity-60">{selectedContact.id}</p>
          </div>

          <div className="w-full flex flex-col items-center">
            {/* Amount Input Card */}
            <div className="relative w-full max-w-[280px] mb-6">
              {/* Glow Effect */}
              <div className="absolute inset-0 bg-[#E5D5B3]/5 rounded-[2rem] blur-xl scale-110 opacity-50" />

              {/* Card */}
              <div className="relative bg-zinc-900/60 backdrop-blur-xl border border-white/10 rounded-[1rem] p-4 shadow-xl">
                {/* Label */}
                {/* <p className="text-[10px] font-black text-zinc-500 uppercase  text-center mb-2">Enter Amount</p> */}

                {/* Amount Input */}
                <div className="flex items-center justify-start gap-">
                  <span className={`font-black transition-all duration-300 ${amount ? 'text-[#E5D5B3] text-4xl' : 'text-zinc-600 text-3xl'}`}>₹</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={amount ? parseInt(amount).toLocaleString('en-IN') : ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      if (val.length <= 8) setAmount(val);
                    }}
                    placeholder="0"
                    className="bg-transparent text-white text-3xl flex-1 font-black text-center w-full outline-none placeholder-zinc-700 caret-[#E5D5B3]"
                    style={{ maxWidth: `${Math.max(60, (amount?.length || 1) * 35)}px` }}
                  />
                </div>

                {/* Underline Accent */}
                {/* <div className="mt-4 mx-auto w-16 h-1 rounded-full bg-gradient-to-r from-transparent via-[#E5D5B3]/30 to-transparent" /> */}
              </div>
            </div>

            {/* Direct Liquidation Info - Only for UPI */}
            {selectedContact && !selectedContact.id.endsWith('@stellar') && amount && (
              <div className="w-full max-w-[280px] mb-6 p-4 bg-[#E5D5B3]/5 border border-[#E5D5B3]/10 rounded-2xl animate-in font-sans">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap size={12} className="text-[#E5D5B3]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#E5D5B3]">Express Liquidation</span>
                  </div>
                  <div className="px-1.5 py-0.5 bg-[#E5D5B3]/10 rounded border border-[#E5D5B3]/20">
                    <span className="text-[7px] font-black text-[#E5D5B3] uppercase tracking-tighter">Sandbox</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[9px] font-bold text-zinc-500 uppercase tracking-tight">
                    <span>Bridge Fee (1.5%)</span>
                    <span className="text-zinc-300">₹{(parseFloat(amount) * 0.015).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-[9px] font-bold text-zinc-500 uppercase tracking-tight">
                    <span>Est. XLM Cost</span>
                    <span className="text-[#E5D5B3] font-black">~{((parseFloat(amount) * 1.015) / xlmRate).toFixed(4)} XLM</span>
                  </div>
                  <div className="pt-2 mt-2 border-t border-white/5 flex items-center gap-2">
                    <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest opacity-80">Direct Payout Channel Open</span>
                  </div>
                </div>
              </div>
            )}

            {/* Note Input */}
            {/* <div className="w-full max-w-[240px] relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-all group-focus-within:scale-110">
                <Zap size={14} className="text-[#E5D5B3] opacity-50 group-focus-within:opacity-100 transition-opacity" />
              </div>
              <input
                type="text"
                placeholder="ADD NOTE"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className="w-full pl-10 pr-4 py-3.5 bg-zinc-900/50 backdrop-blur-md border border-white/5 rounded-2xl text-[#E5D5B3] text-[10px] font-black uppercase tracking-widest placeholder-zinc-600 focus:outline-none focus:border-[#E5D5B3]/30 focus:bg-zinc-900/70 transition-all text-center"
              />
            </div> */}

            {/* Category Selector */}
            <div className="w-full overflow-x-auto no-scrollbar py-3">
              <div className="flex gap-5 px-2 justify-center">
                {([
                  { name: 'Shopping' as const, icon: '🛍️' },
                  { name: 'Food' as const, icon: '🍕' },
                  { name: 'Travel' as const, icon: '✈️' },
                  { name: 'Bills' as const, icon: '📄' },
                  { name: 'Entertainment' as const, icon: '🎬' },
                  { name: 'Other' as const, icon: '💸' },
                ]).map((cat) => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setCategory(cat.name)}
                    className="flex flex-col items-center gap-2 group mb-5"
                  >
                    <div className={`relative w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all duration-300 ${category === cat.name
                      ? 'bg-zinc-800 ring-2 ring-white/80 ring-offset-2 ring-offset-[#0a0f0a]  shadow-lg shadow-white/10'
                      : 'bg-zinc-900/80 border border-white/10 hover:bg-zinc-800/80 hover:border-white/20'
                      }`}>
                      {cat.icon}
                      {category === cat.name && (
                        <div className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5L4.5 7.5L8 3" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-wider transition-colors ${category === cat.name ? 'text-white' : 'text-zinc-600'
                      }`}>
                      {cat.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-20 bg-white rounded-t-[1.5rem] p-8 pb-12 shadow-2xl">
          <h3 className="text-zinc-400 font-black text-[10px] uppercase tracking-[0.2em] mb-6">Payment Method</h3>

          <div className="space-y-4">
            <button
              onClick={() => setPaymentMethod('wallet')}
              className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all border-2 ${paymentMethod === 'wallet' ? 'border-black bg-zinc-50' : 'border-zinc-100'
                }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${paymentMethod === 'wallet' ? 'bg-black text-[#E5D5B3]' : 'bg-zinc-100 text-zinc-400'
                  }`}>
                  <Wallet size={18} />
                </div>
                <div className="text-left">
                  <p className="font-black text-black text-sm tracking-tight">Main Vault</p>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    Available: {symbol}{loadingBalances ? '...' : xlmToInr(walletBalance)}
                  </p>
                </div>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'wallet' ? 'border-black' : 'border-zinc-200'
                }`}>
                {paymentMethod === 'wallet' && <div className="w-2.5 h-2.5 bg-black rounded-full" />}
              </div>
            </button>

            {/* Render ALL family wallets */}
            {familyWallets.map((familyWallet, index) => (
              <button
                key={familyWallet.permission.id}
                onClick={() => {
                  setPaymentMethod('family');
                  setSelectedFamilyIndex(index);
                }}
                className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all border-2 ${paymentMethod === 'family' && selectedFamilyIndex === index
                  ? 'border-zinc-900 bg-zinc-50'
                  : 'border-zinc-100'
                  }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${paymentMethod === 'family' && selectedFamilyIndex === index
                    ? 'bg-zinc-900 text-[#E5D5B3]'
                    : 'bg-zinc-100 text-zinc-400'
                    }`}>
                    <Shield size={18} />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-black text-sm tracking-tight">
                      {familyWallet.ownerProfile.displayName || familyWallet.ownerProfile.stellarId.split('@')[0]}'s Family
                    </p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                      Remaining: {symbol}{getFamilyRemainingLimit(familyWallet).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'family' && selectedFamilyIndex === index
                  ? 'border-zinc-900'
                  : 'border-zinc-200'
                  }`}>
                  {paymentMethod === 'family' && selectedFamilyIndex === index && (
                    <div className="w-2.5 h-2.5 bg-zinc-900 rounded-full" />
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Path Payment - DEX Routing (no trustline needed) */}
          {paymentMethod === 'wallet' && selectedContact?.id.endsWith('@stellar') && amount && parseFloat(amount) > 0 && (
            <div className="mt-4">
              <PathPaymentSelector
                senderPublicKey={profile?.publicKey || ''}
                xlmAmountToSend={(parseFloat(amount) / xlmRate).toFixed(6)}
                disabled={loading}
                onRouteSelect={(routeAsset, quote) => {
                  setDexRouteAsset(routeAsset);
                  setIsPathPayment(routeAsset !== 'XLM');
                  setDexQuote(quote);
                }}
              />
            </div>
          )}



          {/* Chillar Savings Toggle */}
          {paymentMethod === 'wallet' && amount && parseFloat(amount) > 0 && !isPathPayment && (
            <div className="mt-6 p-4 bg-zinc-50 rounded-2xl border border-zinc-100 animate-in fade-in slide-in-from-top-2 duration-500">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-zinc-900 border border-zinc-200 shadow-sm">
                    <img src="/gullak.png" className="w-7 h-7 object-contain" alt="Gullak" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-black text-xs text-black uppercase tracking-tight">Chillar Round-up</span>
                    <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest leading-none mt-0.5">Save as you spend</p>
                  </div>
                </div>
                <button
                  onClick={() => setChillarEnabled(!chillarEnabled)}
                  className={`w-12 h-6 rounded-full transition-all duration-300 relative flex items-center px-1 ${chillarEnabled ? 'bg-zinc-900 shadow-lg shadow-black/10' : 'bg-zinc-200'}`}
                >
                  <div className={`absolute w-4 h-4 rounded-full bg-white transition-all duration-300 shadow-sm flex items-center justify-center ${chillarEnabled ? 'left-7' : 'left-1'}`}>
                    {chillarEnabled && <Check size={8} className="text-zinc-900 font-black" />}
                  </div>
                </button>
              </div>

              {chillarEnabled && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-200/50">
                  <div>
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none mb-1">
                      Pay Recipient: {symbol}{parseFloat(amount).toLocaleString()}
                    </p>
                    <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest leading-none">
                      Save to Gullak: {symbol}{calculateChillarAmount(parseFloat(amount))}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Deduction</p>
                    <p className="text-sm font-black text-black">
                      {symbol}{(parseFloat(amount) + calculateChillarAmount(parseFloat(amount))).toFixed(2)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Path Payment - Chillar is disabled for path payments */}

          <button
            onClick={handlePay}
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="w-full mt-10 gold-gradient text-black h-[72px] rounded-2xl font-black text-xl shadow-2xl active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale flex items-center justify-center gap-3"
          >
            {loading || authenticating ? (
              <div className="flex items-center gap-3">
                {generatingProof ? (
                  <Shield size={22} className="text-black animate-pulse" />
                ) : (
                  <div className="w-6 h-6 border-4 border-black/20 border-t-black rounded-full animate-spin" />
                )}
                <span className="text-sm uppercase tracking-widest">
                  {statusMessage || (generatingProof ? 'Generating ZK Proof...' : authenticating ? 'Biometric Auth...' : 'Confirming...')}
                </span>
              </div>
            ) : (
              <>
                <span>{profile?.passkeyEnabled ? 'Pay with Biometrics' : 'Confirm Transfer'}</span>
                {profile?.passkeyEnabled ? <Fingerprint size={20} /> : <Send size={20} />}
              </>
            )}
          </button>

          {error && <p className="text-red-500 text-[10px] font-bold text-center mt-4 uppercase tracking-widest">{error}</p>}

          {/* Freighter Pay Button */}
          {selectedContact && amount && parseFloat(amount) > 0 && (
            <button
              onClick={handleFreighterSend}
              disabled={loading || wcStatus === 'pairing'}
              className="w-full mt-4 py-4 bg-purple-600/10 border border-purple-500/20 text-purple-400 rounded-2xl font-black text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-3 active:scale-[0.98] transition-all disabled:opacity-30"
            >
              <Wallet size={18} />
              Pay with Freighter
            </button>
          )}
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen  bg-gradient-to-b from-[#0a0f0a] via-[#0d1210] to-[#0a0f0a] text-white">
      <div className="pt-5 px-5 flex items-center justify-between mb-5">
        <div>
          <button
            onClick={() => navigate("/")}
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/5 text-white/60 hover:bg-white/10 transition-all"
          >
            <ArrowLeft size={20} />
          </button>
          {/* <h2 className="text-4xl font-black tracking-tighter">Transfer</h2> */}
        </div>

      </div>

      <div className="px-5 mb-10 mt-8">
        <div className="relative group">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-[#E5D5B3] transition-colors" size={20} />
          <input
            type="text"
            placeholder="Search contacts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-16 pr-6 py-3 bg-zinc-800/60 border border-white/5 rounded-2xl shadow-inner focus:ring-1 focus:ring-[#E5D5B3] font-bold text-lg text-white placeholder-zinc-700"
          />
        </div>
      </div>

      <div className="px-5 mb-12">
        <button
          onClick={() => {
            setIsUpiDrawerOpen(true);
            setUpiInput('');
          }}
          className="w-full flex items-center justify-between p-3 bg-zinc-900/80 border border-white/5 rounded-2xl shadow-xl active:scale-[0.98] transition-all group"
        >
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 gold-gradient rounded-xl flex items-center justify-center text-black">
              <BadgeIndianRupee />
            </div>
            <div className="text-left">
              <p className="font-black text-white text-lg leading-none mb-1">New Pay</p>
              <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">External UPI ID</p>
            </div>
          </div>
          <ChevronRight size={20} className="text-zinc-700 group-hover:text-[#E5D5B3] transition-all" />
        </button>
      </div>

      <UpiDrawer
        isOpen={isUpiDrawerOpen}
        onClose={() => setIsUpiDrawerOpen(false)}
        upiInput={upiInput}
        setUpiInput={setUpiInput}
        onSearch={async () => {
          if (upiInput.trim()) {
            const id = upiInput.trim();
            const profile = await getProfileByStellarId(id);
            setSelectedContact({
              id,
              name: profile?.displayName || id.split('@')[0],
              avatarSeed: profile?.avatarSeed || id
            });
            setIsUpiDrawerOpen(false);
          }
        }}
        searching={false}
      />

      <div className="px-8 mb-10">
        <button
          onClick={syncContacts}
          disabled={syncing}
          className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center gap-3 hover:bg-white/10 transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
            <Users size={16} />
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-zinc-300">
            {syncing ? 'Syncing Contacts...' : 'Find Contacts on Stellar'}
          </span>
        </button>
      </div>

      <div className="px-8 pb-32">
        {onStellarContacts.length > 0 && (
          <div className="mb-10">
            <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Contacts Joined
            </h3>
            <div className="grid grid-cols-1 gap-6">
              {onStellarContacts.map(contact => (
                <button
                  key={contact.id}
                  onClick={() => setSelectedContact(contact)}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-zinc-800 rounded-2xl overflow-hidden border border-white/5 group-hover:border-[#E5D5B3]/50 transition-all shadow-lg">
                      <img
                        src={getAvatarUrl(contact.avatarSeed || contact.id)}
                        alt={contact.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className="font-bold text-white text-base leading-none mb-1 capitalize truncate">{contact.name}</p>
                      <p className="text-[10px] font-bold text-zinc-400 tracking-tight truncate">{contact.id}</p>
                    </div>
                  </div>
                  <div className="p-2 border border-white/5 rounded-xl group-hover:border-[#E5D5B3]/30 transition-all">
                    <ChevronRight size={16} className="text-zinc-700" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {inviteContacts.length > 0 && (
          <div className="mb-10">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-6">Invite to Stellar</h3>
            <div className="grid grid-cols-1 gap-6">
              {inviteContacts.slice(0, 15).map((contact, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-zinc-900/50 rounded-2xl flex items-center justify-center text-zinc-700 border border-white/5">
                      <Smartphone size={20} />
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className="font-bold text-zinc-300 text-base leading-none mb-1 capitalize truncate">{contact.name}</p>
                      <p className="text-[10px] font-bold text-zinc-600 tracking-tight truncate">{contact.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleInvite(contact.name)}
                      className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                      Invite
                    </button>
                    <button
                      onClick={() => {
                        setSelectedContact({ id: contact.phone, name: contact.name, avatarSeed: contact.phone });
                        setIsViralLinkMode(true);
                      }}
                      className="px-3 py-2 bg-[#E5D5B3]/5 border border-[#E5D5B3]/20 rounded-xl text-[#E5D5B3] text-[10px] font-black uppercase tracking-widest hover:bg-[#E5D5B3]/10 transition-all"
                    >
                      Send {symbol}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {onStellarContacts.length === 0 && (
          <div className="mt-10">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-6">Recent Ledger</h3>
            {loadingContacts ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-4 border-[#E5D5B3] border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="bg-zinc-900/40 rounded-[1rem] border border-white/5 p-12 text-center">
                <p className="text-zinc-500 font-bold">No recent activity found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {filteredContacts.map(contact => (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedContact(contact)}
                    className="flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-5">
                      <div className="w-12 h-12 bg-zinc-800 rounded-2xl overflow-hidden border border-white/5 group-hover:border-[#E5D5B3]/50 transition-all shadow-lg">
                        <img
                          src={getAvatarUrl(contact.avatarSeed || contact.id)}
                          alt={contact.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <p className="font-bold text-white text-base leading-none mb-1 capitalize truncate">{contact.name}</p>
                        <p className="text-[10px] font-bold text-zinc-400 tracking-tight truncate">{contact.id}</p>
                      </div>
                    </div>
                    <div className="p-2 border border-white/5 rounded-xl group-hover:border-[#E5D5B3]/30 transition-all">
                      <ChevronRight size={16} className="text-zinc-700" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Freighter WalletConnect Modal */}
      {showFreighterModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeFreighterModal}></div>
          <div className="relative w-full max-w-md bg-zinc-900 rounded-t-[3rem] p-8 border-t border-purple-500/20">
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-white/20 rounded-full" />

            <button
              onClick={closeFreighterModal}
              className="absolute top-6 right-6 p-2 bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-all"
            >
              <span className="text-lg">✕</span>
            </button>

            <div className="flex items-center gap-3 mb-6 mt-4">
              <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
                <Wallet size={20} className="text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-black">Pay via Freighter</h3>
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  {selectedContact?.name} · {amount} XLM
                </p>
              </div>
            </div>

            {/* Step 1: Scan QR */}
            {wcStatus === 'pairing' && wcUri && (
              <div className="flex flex-col items-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
                  Scan with Freighter App
                </p>
                <div className="bg-white p-4 rounded-2xl mb-4">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(wcUri)}&color=1A1A1A&bgcolor=FFFFFF`}
                    alt="WalletConnect QR"
                    className="w-56 h-56"
                  />
                </div>
                <p className="text-zinc-500 text-xs text-center">
                  Open Freighter → Scan → Approve connection
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-purple-400" />
                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">
                    Waiting for Freighter...
                  </span>
                </div>
              </div>
            )}

            {wcStatus === 'pairing' && !wcUri && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={32} className="animate-spin text-purple-400 mb-4" />
                <p className="text-zinc-500 text-sm">Initializing WalletConnect...</p>
              </div>
            )}

            {/* Step 2: Requesting */}
            {wcStatus === 'requesting' && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={32} className="animate-spin text-purple-400 mb-4" />
                <p className="text-sm font-bold text-white mb-1">Approve in Freighter</p>
                <p className="text-zinc-500 text-xs text-center">
                  Check the Freighter app to approve the {amount} XLM transaction
                </p>
              </div>
            )}

            {/* Step 3: Done */}
            {wcStatus === 'done' && (
              <div className="flex flex-col items-center py-8">
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                  <Check size={32} className="text-emerald-400" />
                </div>
                <h4 className="text-xl font-black text-white mb-2">Payment Sent!</h4>
                <p className="text-zinc-400 text-sm">
                  {amount} XLM → {selectedContact?.name}
                </p>
                <button
                  onClick={closeFreighterModal}
                  className="mt-6 px-8 py-3 bg-white/10 rounded-xl font-bold text-sm"
                >
                  Done
                </button>
              </div>
            )}

            {/* Error */}
            {wcStatus === 'error' && (
              <div className="flex flex-col items-center py-8">
                <p className="text-rose-400 font-bold text-sm mb-4">{wcError}</p>
                <button
                  onClick={handleFreighterSend}
                  className="px-6 py-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl font-bold text-sm"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SendMoney;

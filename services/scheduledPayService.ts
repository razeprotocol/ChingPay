
import { getScheduledPayments, updateScheduledPaymentStatus, recordTransaction, updatePersonalSpend, getProfile, getUserById } from './db';
import { sendPayment, getBalance } from './stellar';
import { decryptSecret } from './encryption';
import { KYCService } from './kycService';
import { UserProfile, ScheduledPayment } from '../types';
import { NotificationService } from './notification';
import { calculateCryptoToSend } from './priceService';

export class ScheduledPayService {
    private static intervalId: any = null;
    private static currentProfileId: string | null = null;
    // In-memory lock to prevent duplicate execution of the same payment
    private static processingIds: Set<string> = new Set();

    static start(profile: UserProfile) {
        if (this.currentProfileId && this.currentProfileId !== profile.uid) {
            this.stop();
        }

        if (this.intervalId) return;

        this.currentProfileId = profile.uid;
        console.log("📅 Scheduled Pay Worker Started for", profile.stellarId);

        // Run once immediately
        this.processDuePayments(profile);

        // Then every 30 seconds
        this.intervalId = setInterval(() => {
            this.processDuePayments(profile);
        }, 30000);
    }

    static stop() {
        if (this.intervalId) {
            console.log("🛑 Scheduled Pay Worker Stopped");
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.currentProfileId = null;
            this.processingIds.clear();
        }
    }

    private static async processDuePayments(profile: UserProfile) {
        try {
            const freshProfile = await getProfile(profile.uid);
            if (!freshProfile) {
                console.error("❌ ScheduledPay: Could not refresh profile");
                return;
            }

            const payments = await getScheduledPayments(freshProfile.uid);
            const now = new Date();

            const pendingPayments = payments.filter(p => p.status === 'pending');
            if (pendingPayments.length === 0) return;

            for (const payment of pendingPayments) {
                // Skip if already being processed (in-memory lock)
                if (this.processingIds.has(payment.id)) {
                    console.log(`⏳ Skipping ${payment.id} — already in-flight`);
                    continue;
                }

                let scheduledTime: Date;
                if (payment.scheduledDate && typeof payment.scheduledDate.toDate === 'function') {
                    scheduledTime = payment.scheduledDate.toDate();
                } else if (payment.scheduledDate?.seconds) {
                    scheduledTime = new Date(payment.scheduledDate.seconds * 1000);
                } else {
                    scheduledTime = new Date(payment.scheduledDate);
                }

                if (scheduledTime <= now) {
                    // Lock BEFORE executing
                    this.processingIds.add(payment.id);
                    try {
                        await this.executePayment(freshProfile, payment);
                    } finally {
                        // Release lock after execution (success or failure)
                        this.processingIds.delete(payment.id);
                    }
                }
            }
        } catch (error) {
            console.error("❌ ScheduledPay processing error:", error);
        }
    }

    private static async executePayment(profile: UserProfile, payment: ScheduledPayment) {
        console.log(`📅💸 EXECUTING SCHEDULED: ₹${payment.amount} → ${payment.recipientName}`);

        // IMMEDIATELY mark as 'completed' in Firestore BEFORE executing.
        // This prevents any future poll from picking it up again, even
        // if this process crashes mid-way. A double-pay is worse than
        // a missed pay (which the user can retry).
        await updateScheduledPaymentStatus(payment.id, 'completed');

        try {
            const phone = localStorage.getItem('ching_phone') || '';
            const password = KYCService.deriveEncryptionKey(phone, profile.pin || '0000');

            if (!profile.encryptedSecret) {
                await updateScheduledPaymentStatus(payment.id, 'failed', undefined, 'Missing encrypted secret');
                return;
            }

            let secret = decryptSecret(profile.encryptedSecret, password);

            // Fallback to '0000' if current PIN fails
            if (!secret || !secret.startsWith('S')) {
                const fallbackPassword = KYCService.deriveEncryptionKey(phone, '0000');
                secret = decryptSecret(profile.encryptedSecret, fallbackPassword);
            }

            if (!secret || !secret.startsWith('S')) {
                await updateScheduledPaymentStatus(payment.id, 'failed', undefined, 'Vault decryption failed');
                return;
            }

            // Resolve recipient public key
            const recipientInfo = await getUserById(payment.recipientStellarId);
            if (!recipientInfo) {
                await updateScheduledPaymentStatus(payment.id, 'failed', undefined, 'Recipient not found');
                return;
            }

            // Check balance
            const balanceStr = await getBalance(profile.publicKey);
            const xlmAmount = await calculateCryptoToSend(payment.amount, 'stellar', 'INR', 1.02);
            const balance = parseFloat(balanceStr);

            if (balance < xlmAmount) {
                await updateScheduledPaymentStatus(payment.id, 'failed', undefined, 'Insufficient balance');
                return;
            }

            // Execute payment
            const hash = await sendPayment(
                secret,
                recipientInfo.publicKey,
                xlmAmount.toString(),
                payment.memo || `Scheduled: ${payment.recipientName}`
            );

            // Record transaction
            await updatePersonalSpend(profile.uid, payment.amount);
            await recordTransaction({
                fromId: profile.stellarId,
                toId: payment.recipientStellarId,
                fromName: profile.displayName || profile.stellarId,
                toName: payment.recipientName,
                amount: payment.amount,
                currency: 'INR',
                status: 'SUCCESS',
                txHash: hash,
                isFamilySpend: false,
                category: payment.category || 'Other'
            });

            // Update with the actual tx hash
            await updateScheduledPaymentStatus(payment.id, 'completed', hash);

            // Notify recipient
            NotificationService.sendInAppNotification(
                payment.recipientStellarId,
                "Scheduled Payment Received",
                `You received ₹${payment.amount} from ${profile.displayName || profile.stellarId.split('@')[0]}`,
                'payment'
            );

            console.log(`✅ Scheduled Pay SUCCESS: ₹${payment.amount} → ${payment.recipientName}`);
        } catch (error: any) {
            console.error(`❌ Scheduled Pay failed for ${payment.recipientName}:`, error);
            await updateScheduledPaymentStatus(payment.id, 'failed', undefined, error.message || 'Unknown error');
        }
    }
}


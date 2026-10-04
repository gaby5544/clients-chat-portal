// Seller Terms of Service & Transaction Policy — shown at registration and
// accepted with a mandatory checkbox. Bump TERMS_VERSION whenever the wording
// changes; the version a seller accepted is stored against their account.
const TERMS_VERSION = '2026-10-v1';
const COMPLAINTS_EMAIL = process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com';

const TERMS_SECTIONS = [
  { title: '1. About this agreement', body: [
    'These Terms of Service and Transaction Policy (the "Terms") govern your use of the Transaction Account provided by the Quantum Secure Transaction Desk (the "Desk"). By creating an account you confirm that you have read, understood and agree to be bound by them.',
    'The Desk acts as a neutral intermediary that records, verifies and safeguards the movement of funds between a buyer and a seller for a single agreed transaction. The Desk is not a party to the underlying sale and does not guarantee the quality, legality or delivery of any goods or services.' ] },
  { title: '2. Eligibility and your account', body: [
    'You must be at least 18 years old, legally able to enter into binding contracts, and acting on your own behalf (or with proper authority for the business you represent).',
    'You agree to provide complete, accurate and current information, and to keep it up to date. The email address you register is permanently tied to your account and cannot be changed after the account is created. Your account currency is fixed at registration.',
    'You are responsible for keeping your password, verification codes and devices secure. Notify the Desk immediately if you suspect unauthorised access.' ] },
  { title: '3. Identity verification and compliance', body: [
    'To protect all parties and to meet anti-money-laundering (AML), counter-terrorist-financing and sanctions obligations, the Desk may require identity documents, proof of address, a live face verification, source-of-funds information and, for business accounts, company registration and tax details.',
    'Documents that are unreadable, expired, altered, belong to another person or do not match your registered details will be rejected. Submitting false or forged documents will result in immediate account disablement and may be reported to the relevant authorities.' ] },
  { title: '4. Your obligations as a seller', body: [
    'You agree to deliver the goods, services or assets described in the transaction exactly as agreed with the buyer, in the agreed condition and within the agreed time, and to cooperate promptly with any reasonable request from the Desk.',
    'You must not misrepresent the goods or services, sell anything unlawful or prohibited, or use the Desk to move funds that are the proceeds of crime or that you are not entitled to receive.' ] },
  { title: '5. Handling of funds', body: [
    'Funds recorded against your account move through defined review stages: payment received, payer verification, authenticity review, payment confirmed, and funds in your vault account. Funds held in the vault are not available for withdrawal until they have been released to your available balance.',
    'The Desk may hold, delay, reverse or return funds where a payment cannot be verified, is disputed, appears fraudulent, or where required by law or by a competent authority. Where a payment is reversed the corresponding amount will be removed from your account.' ] },
  { title: '6. Withdrawals and disbursement', body: [
    'You may only withdraw funds once the Desk has placed your transaction in the disbursement stage, which happens after both parties have fulfilled their obligations. Withdrawal requests made before then will not be accepted.',
    'Every withdrawal must be confirmed with a one-time code sent to your registered email address. A daily withdrawal limit applies to standard accounts; higher or unlimited limits require an approved business account. Crypto withdrawals may require a prior verified crypto deposit to establish a funding trail.',
    'Withdrawals move through the statuses Pending, Processing, Completed or Declined. The Desk may decline a withdrawal and will state the reason.' ] },
  { title: '7. Prohibited activity', body: [
    'You must not use the account for fraud, money laundering, sanctions evasion, impersonation, or to circumvent the Desk\'s controls; share your login with anyone else; or attempt to disrupt or gain unauthorised access to the service.' ] },
  { title: '8. Security, monitoring and IP addresses', body: [
    'For your protection the Desk records the IP address used when you register, sign in and request withdrawals, and may block an IP address that appears suspicious. Messages and activity within the transaction group may be retained and reviewed for security, dispute-resolution and compliance purposes.' ] },
  { title: '9. Fees and currency conversion', body: [
    'Any applicable fees will be shown before you confirm an action. Where a payment is received in a currency different from your account currency it is converted at the rate in force when it is recorded.' ] },
  { title: '10. Suspension, disablement and complaints', body: [
    'The Desk may suspend or disable an account where required for security, compliance or investigation, or where these Terms are breached. You will be notified on screen and by email when your account is disabled or re-enabled.',
    'If you believe your account was disabled in error, or you wish to raise a complaint, contact ' + COMPLAINTS_EMAIL + '. Please include your Account ID.' ] },
  { title: '11. Privacy and data protection', body: [
    'Personal data (including identity documents, contact details and IP addresses) is processed only to operate your account, verify your identity, prevent fraud and meet legal obligations, and is retained for as long as the law requires.' ] },
  { title: '12. Limitation of liability', body: [
    'To the fullest extent permitted by law, the Desk is not liable for losses arising from the conduct of either party to the transaction, delays caused by third-party banks, networks or blockchains, or events beyond its reasonable control. Nothing in these Terms excludes liability that cannot be excluded by law.' ] },
  { title: '13. Changes and governing law', body: [
    'The Desk may update these Terms; material changes will be notified and the version you accepted is recorded against your account. These Terms are governed by the laws applicable to the Desk\'s operating jurisdiction, and disputes will be resolved in its competent courts unless the law requires otherwise.' ] }
];

const TERMS_CHECKBOX_LABEL =
  'I have read and agree to the Terms of Service and Transaction Policy, and I confirm that the information I have provided is true and complete.';

module.exports = { TERMS_VERSION, TERMS_SECTIONS, TERMS_CHECKBOX_LABEL, COMPLAINTS_EMAIL };

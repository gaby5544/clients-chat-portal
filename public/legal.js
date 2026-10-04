/* Terms & Policy for the Transaction Account. Shared by the browser (shown in the
   registration form) and the server (records which version a seller accepted). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LEGAL_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    version: '2026-10',
    title: 'Terms of Service & Escrow Policy',
    updated: 'October 2026',
    intro: 'These Terms govern your use of the Transaction Account and the escrow transaction desk (the “Service”). By creating an account you confirm that you have read, understood and agree to them.',
    sections: [
      { h: '1. The Service and your role', p: [
        'The Service provides a secure, monitored environment in which a Buyer and a Seller agree the terms of a transaction, and in which payments made by the Buyer are received, reviewed and held by the Desk in escrow until the agreed conditions are met.',
        'The Desk acts as a neutral escrow and settlement agent. It is not a party to the underlying sale and does not guarantee the quality, legality, title or delivery of any goods or services.'] },
      { h: '2. Eligibility and account information', p: [
        'You must be at least 18 years old, legally able to enter into binding contracts, and acting on your own behalf (or on behalf of a business you are authorised to represent).',
        'You agree to provide accurate, complete and current information, including your legal name, date of birth, country, phone number and email address, and to keep it up to date. The email address linked to your account is permanent and cannot be changed after registration.',
        'Each person may hold one Transaction Account. You are responsible for keeping your password confidential and for all activity under your account.'] },
      { h: '3. How escrow works', p: [
        'Incoming payments are recorded by the Desk and placed in the vault. Each payment passes through a staged review — receipt, payer verification, authenticity review, confirmation by escrow, and release to the Seller’s account. Funds remain in the vault, and are not available to withdraw, until the review completes.',
        'The Desk may pause, extend or reverse a review where it reasonably suspects fraud, a chargeback risk, a sanctions concern or a breach of these Terms, or where it is required to do so by law.'] },
      { h: '4. Withdrawals and disbursement', p: [
        'Funds can be withdrawn only after (a) your identity has been verified, (b) the Desk has confirmed that the transaction has reached the disbursement stage, and (c) you have confirmed the request with the one-time code sent to your registered email.',
        'Withdrawals are subject to a daily limit unless you have been approved for a business account. A first withdrawal by cryptocurrency may require a prior verified crypto deposit as a source-of-funds control; bank withdrawals are not affected by this requirement.',
        'Withdrawal requests move through the stages Pending, Processing, and Completed or Declined. The Desk may decline a request that fails verification or compliance checks and will state the reason. Network, bank or intermediary charges may apply and are outside the Desk’s control.'] },
      { h: '5. Identity verification (KYC) and compliance', p: [
        'We are required to verify your identity and, for business accounts, your company and beneficial owners. Submitting false, altered, expired or another person’s documents is prohibited and will result in rejection and may result in account closure and referral to the relevant authorities.',
        'We may request additional information at any time and may restrict an account while a review is open. We screen activity against sanctions and anti-money-laundering requirements.'] },
      { h: '6. Prohibited use', p: [
        'You must not use the Service for unlawful activity, money laundering, terrorist financing, fraud, the sale of prohibited goods, or to circumvent verification, limits or the escrow process. You must not attempt to access another user’s account or interfere with the security of the Service.'] },
      { h: '7. Security, location and device data', p: [
        'For security we record the IP address and approximate location of registrations, sign-ins and withdrawal requests. The Desk may block an IP address for an account where activity appears unauthorised or risky.'] },
      { h: '8. Privacy and communications', p: [
        'We process your personal data to provide the Service, meet legal obligations and keep the platform secure. Identity documents are used only for verification and compliance and are accessible only to authorised staff.',
        'You agree to receive service notifications — including verification codes, payment, withdrawal and security alerts — by in-app notice, push notification and email, in your chosen language. Unread messages may trigger periodic reminders.'] },
      { h: '9. Suspension and termination', p: [
        'The Desk may disable or close an account that breaches these Terms or where required by law. While an account is disabled you cannot transact or withdraw; to contest a decision, contact complaints@usvistra.com. Funds held for a disabled account remain safeguarded pending resolution.'] },
      { h: '10. Liability', p: [
        'To the fullest extent permitted by law, the Desk is not liable for losses arising from the conduct of the Buyer or Seller, delays caused by banks, networks or third parties, incorrect payout details supplied by you, or events beyond its reasonable control. Nothing in these Terms excludes liability that cannot be excluded by law.'] },
      { h: '11. Changes and contact', p: [
        'We may update these Terms; the version you accept is recorded against your account, and material changes will be notified to you. Questions or complaints: complaints@usvistra.com.'] }
    ],
    accept: 'I have read and agree to the Terms of Service & Escrow Policy.'
  };
});

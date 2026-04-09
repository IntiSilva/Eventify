import { EmailLayout } from './EmailLayout';
import { FooterNote, Hr, InfoRow, Logo, P, Subtitle, Title } from './ui';

export interface RefundConfirmationEmailProps {
  attendeeName: string;
  buyerEmail: string;
  eventName: string;
  eventDateTime: string;
  eventTimeZone: string;
  eventLocation: string | null;
  refundAmountFormatted: string;
  refundCurrency: string;
  refundReference: string | null;
  refundReferenceNote: string | null;
  refundId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
}

export const RefundConfirmationEmail = ({
  attendeeName,
  buyerEmail,
  eventName,
  eventDateTime,
  eventTimeZone,
  eventLocation,
  refundAmountFormatted,
  refundCurrency,
  refundReference,
  refundReferenceNote,
  refundId,
  paymentIntentId,
  chargeId,
}: RefundConfirmationEmailProps) => (
  <EmailLayout preview={`Refund confirmed - ${eventName}`}>
    <Logo />

    <Title align="center" size={28}>Refund confirmed</Title>

    <P>
      Hi {attendeeName}, your refund has been confirmed. Keep this email for your
      records.
    </P>
    <P muted>
      Stripe indicates the funds may take 5-10 days to reach the customer&apos;s
      bank.
    </P>

    <Hr />

    <InfoRow label="Event" value={eventName} />
    <InfoRow
      label="Date & time"
      value={`${eventDateTime} (${eventTimeZone})`}
    />
    <InfoRow label="Location" value={eventLocation ?? 'TBA'} />

    <Hr />

    <InfoRow
      label="Refunded amount"
      value={`${refundAmountFormatted} (${refundCurrency})`}
    />
    <InfoRow label="Confirmation sent to" value={buyerEmail} />

    {refundReference ? (
      <>
        <InfoRow label="Refund reference number" value={refundReference} />
        {refundReferenceNote ? <P muted>{refundReferenceNote}</P> : null}
      </>
    ) : null}

    {refundId || paymentIntentId || chargeId ? (
      <>
        <Hr />
        <Subtitle>Support reference</Subtitle>
        <P muted style={{ marginBottom: 12 }}>
          Share these only if support or your bank asks for more context.
        </P>
        {refundId ? <InfoRow label="Refund ID" value={refundId} /> : null}
        {paymentIntentId ? (
          <InfoRow label="Payment reference" value={paymentIntentId} />
        ) : null}
        {chargeId ? <InfoRow label="Charge reference" value={chargeId} /> : null}
      </>
    ) : null}

    <FooterNote>Eventify Platform | (c) {new Date().getFullYear()}</FooterNote>
  </EmailLayout>
);

export default RefundConfirmationEmail;

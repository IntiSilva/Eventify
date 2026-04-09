import { EmailLayout } from './EmailLayout';
import { FooterNote, Hr, InfoRow, Logo, P, Title } from './ui';

export interface TicketPurchaseConfirmationEmailProps {
  attendeeName: string;
  buyerEmail: string;
  eventName: string;
  eventDateTime: string;
  eventTimeZone: string;
  eventLocation: string | null;
  amountFormatted: string;
  eventUrl: string;
}

export const TicketPurchaseConfirmationEmail = ({
  attendeeName,
  buyerEmail,
  eventName,
  eventDateTime,
  eventTimeZone,
  eventLocation,
  amountFormatted,
  eventUrl,
}: TicketPurchaseConfirmationEmailProps) => (
  <EmailLayout preview={`Purchase confirmed • ${eventName}`}>
    <Logo />

    <Title align='center' size={28}>Purchase confirmed</Title>

    <P>
      Hi {attendeeName} — your ticket is confirmed. Keep this email for your records.
    </P>

    <Hr />

    <InfoRow label="Event" value={eventName} />
    <InfoRow
      label="Date & time"
      value={`${eventDateTime} (${eventTimeZone})`}
    />
    <InfoRow label="Location" value={eventLocation ?? 'TBA'} />

    <Hr />

    <InfoRow label="Attendee" value={attendeeName} />
    <InfoRow label="Confirmation sent to" value={buyerEmail} />
    <InfoRow label="Amount paid" value={amountFormatted} />
    <InfoRow label="Event page" value={eventUrl} />

    <Hr />

    <P style={{ textAlign: 'center', marginTop: 12 }}>
      Need help? Reply to this email and we&apos;ll get back to you.
    </P>

    <FooterNote>Eventify Platform | © {new Date().getFullYear()}</FooterNote>
  </EmailLayout>
);

export default TicketPurchaseConfirmationEmail;
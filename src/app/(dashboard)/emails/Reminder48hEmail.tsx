import { EmailLayout } from "./EmailLayout";
import { Logo, Title, P, InfoRow, FooterNote } from "./ui";

export interface Reminder48hEmailProps {
  eventName: string;
  eventDate: string;
  eventLocation: string;
  username: string;
  // eventUrl?: string;
}

export const Reminder48hEmail = ({
  eventName,
  eventDate,
  eventLocation,
  username,
  // eventUrl = "https://tu-app.com", // keep your default if you still need it
}: Reminder48hEmailProps) => (
  <EmailLayout preview={`Reminder: ${eventName} starts in 48 hours`}>
    <Logo />
    <Title>Hi {username}!</Title>

    <P>
      Just a friendly reminder that the event you registered for,
      <strong> {eventName}</strong>, is coming up soon!
    </P>

    <InfoRow label="Date" value={eventDate} />
    <InfoRow label="Location" value={eventLocation} />

    {/* You said you prefer to remove the CTA button for now. If you ever
        want to keep a textual link, uncomment this:

    {eventUrl && (
      <P muted>
        View details:{" "}
        <a href={eventUrl} style={{ color: "#a1a1aa" }}>
          {eventUrl}
        </a>
      </P>
    )}
    */}

    <FooterNote>Eventify Platform • © {new Date().getFullYear()}</FooterNote>
  </EmailLayout>
);

export default Reminder48hEmail;

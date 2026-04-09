import { EmailLayout } from "./EmailLayout";
import {
  Logo,
  Title,
  Subtitle,
  P,
  Hr,
  InfoRow,
  PrimaryButton,
  FooterNote,
} from "./ui";

export interface Reminder48hEmailProps {
  eventName: string;
  eventDate: string;
  eventLocation: string;
  username: string;
  eventUrl?: string;
}

export const Reminder48hEmail = ({
  eventName,
  eventDate,
  eventLocation,
  username,
  eventUrl,
}: Reminder48hEmailProps) => (
  <EmailLayout preview={`In 48 hours • ${eventName}`}>
    <Logo />

    <Title align="center" size={28}>48-hour reminder</Title>

    <P>
      Hi {username}, your event is coming up soon. Here are the details at a
      glance.
    </P>

    <Hr />

    <Subtitle>Event details</Subtitle>
    <InfoRow label="Event" value={eventName} />
    <InfoRow label="Date & time" value={eventDate} />
    <InfoRow label="Location" value={eventLocation} />

    {eventUrl && (
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <PrimaryButton href={eventUrl}>View event details</PrimaryButton>
      </div>
    )}

    <P muted style={{ textAlign: "center", marginTop: 12 }}>
      Can&apos;t make it? Update your attendance status from the event page.
    </P>

    <FooterNote>Eventify Platform • © {new Date().getFullYear()}</FooterNote>
  </EmailLayout>
);

export default Reminder48hEmail;
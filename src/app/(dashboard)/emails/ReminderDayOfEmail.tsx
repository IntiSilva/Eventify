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

export interface ReminderDayOfEmailProps {
  eventName: string;
  eventTime: string;
  eventDate?: string;
  eventLocation: string;
  username: string;
  eventUrl?: string;
}

export const ReminderDayOfEmail = ({
  eventName,
  eventTime,
  eventDate,
  eventLocation,
  username,
  eventUrl,
}: ReminderDayOfEmailProps) => (
  <EmailLayout preview={`Today • ${eventName}`}>
    <Logo />

    <Title align="center" size={28}>It&apos;s today</Title>
    <Subtitle>{eventName}</Subtitle>

    <P>
      Hi {username}, this is a quick reminder that your event is happening
      today.
    </P>

    <Hr />

    <Subtitle>Today&apos;s schedule</Subtitle>
    {eventDate && <InfoRow label="Date" value={eventDate} />}
    <InfoRow label="Time" value={eventTime} />
    <InfoRow label="Location" value={eventLocation} />

    {eventUrl && (
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <PrimaryButton href={eventUrl}>Open event page</PrimaryButton>
      </div>
    )}

    <P muted style={{ textAlign: "center", marginTop: 12 }}>
      If plans change, update your attendance status so others can take your spot.
    </P>

    <FooterNote>Eventify Platform • © {new Date().getFullYear()}</FooterNote>
  </EmailLayout>
);

export default ReminderDayOfEmail;
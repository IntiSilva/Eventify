import * as React from "react";
import { EmailLayout } from "./EmailLayout";
import {
  Logo,
  Title,
  Subtitle,
  P,
  InfoRow,
  FooterNote,
} from "./ui";

export interface ReminderDayOfEmailProps {
  eventName: string;
  eventTime: string;        // <- REQUIRED (what you're currently sending from route.ts)
  eventDate?: string;       // <- OPTIONAL (in case you ever send it as well)
  eventLocation: string;
  username: string;
  // eventUrl?: string;
}

export const ReminderDayOfEmail = ({
  eventName,
  eventTime,
  eventDate,
  eventLocation,
  username,
  // eventUrl = "https://tu-app.com",
}: ReminderDayOfEmailProps) => {
  return (
    <EmailLayout preview={`Hoy es ${eventName}`}>
      <Logo />

      <Title>Hi {username}!</Title>
      <Subtitle>Today is the big day!</Subtitle>

      <P>
        We remind you that the event <strong>{eventName}</strong> it&apos;s{" "}
        <strong>today</strong>. Below we left you the info:
      </P>

      {eventDate && <InfoRow label="Date" value={eventDate} />}
      <InfoRow label="Time" value={eventTime} />
      <InfoRow label="Location" value={eventLocation} />

      {/* {eventUrl && (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <PrimaryButton href={eventUrl}>See event details</PrimaryButton>
        </div>
      )} */}

      <FooterNote>
        Eventify Platform • © {new Date().getFullYear()}
      </FooterNote>
    </EmailLayout>
  );
};

export default ReminderDayOfEmail;

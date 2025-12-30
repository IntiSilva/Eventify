import {
  Button as EmailButton,
  Img,
  Text,
  Heading,
  Hr as EmailHr,
  Section,
  Row,
  Column,
} from "@react-email/components";
import { colors, fonts, radii } from "./theme";


function getSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

const LOGO_URL = `${getSiteUrl()}/logo-eventify-png-2x.png`;


export const Logo = ({ width = 120 }: { width?: number }) => (
  <Section style={{ marginBottom: 24 }}>
    <Row>
      <Column align="center">
        <Img
          src={LOGO_URL}
          alt="Eventify"
          width={width}
          style={{ display: "block", margin: "0 auto" }}
        />
      </Column>
    </Row>
  </Section>
);

export const Title = ({ children }: { children: React.ReactNode }) => (
  <Heading
    style={{
      fontFamily: fonts.display,
      fontWeight: 700,
      fontSize: 24,
      lineHeight: "1.2",
      textAlign: "left" as const,
      margin: "0 0 12px 0",
      color: colors.fg,
    }}
  >
    {children}
  </Heading>
);

export const Subtitle = ({ children }: { children: React.ReactNode }) => (
  <Heading
    as="h2"
    style={{
      fontFamily: fonts.heading,
      fontWeight: 600,
      fontSize: 18,
      lineHeight: "1.3",
      margin: "0 0 8px 0",
      color: colors.fg,
    }}
  >
    {children}
  </Heading>
);

export const P = ({
  muted,
  children,
  style,
}: {
  muted?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <Text
    style={{
      color: muted ? colors.muted : colors.fg,
      fontSize: 16,
      lineHeight: "24px",
      margin: "0 0 12px",
      ...style,
    }}
  >
    {children}
  </Text>
);

export const PrimaryButton = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => (
  <EmailButton
    href={href}
    style={{
      backgroundColor: colors.brand,
      borderRadius: radii.button,
      color: "#fff",
      fontSize: 16,
      textDecoration: "none",
      padding: "12px 20px",
      display: "inline-block",
      textAlign: "center" as const,
    }}
  >
    {children}
  </EmailButton>
);

export const Hr = () => (
  <EmailHr
    style={{
      borderColor: colors.border,
      margin: "24px 0",
    }}
  />
);

export const InfoRow = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <P>
    <strong>{label}:</strong> {value}
  </P>
);

export const FooterNote = ({ children }: { children: React.ReactNode }) => (
  <Text
    style={{
      color: colors.muted,
      fontSize: 12,
      lineHeight: "16px",
      textAlign: "center" as const,
      marginTop: 24,
    }}
  >
    {children}
  </Text>
);

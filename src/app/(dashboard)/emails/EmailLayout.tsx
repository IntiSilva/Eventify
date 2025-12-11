import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
} from "@react-email/components";
import { colors, fonts, radii, layout } from "./theme";
import * as React from "react";

export const EmailLayout = ({
  preview,
  children,
}: {
  preview: string;
  children: React.ReactNode;
}) => (
  <Html>
    <Head />
    <Preview>{preview}</Preview>

    <Body
      style={{
        backgroundColor: colors.bg,
        fontFamily: fonts.body,
        color: colors.fg,
        margin: 0,
        padding: 0,
      }}
    >
      {/* Outer padding to avoid sticking to the client edges */}
      <Section style={{ padding: "32px 0" }}>
        <Container
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.card,
            maxWidth: layout.maxWidth,
            width: "100%",
            margin: "0 auto",
            padding: `${layout.gutterY}px ${layout.gutterX}px`,
          }}
        >
          {children}
        </Container>
      </Section>
    </Body>
  </Html>
);

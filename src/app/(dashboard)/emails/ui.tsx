import {
  Button as EmailButton,
  Img,
  Text,
  Heading,
  Hr as EmailHr,
} from "@react-email/components";
import { colors, fonts, radii } from "./theme";

// TEMPORARY: inline Base64 until you move to a public URL.
// Gmail usually blocks data URIs, but you told me “let's keep it like this for now”.
const LOGO_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHEAAAB4CAMAAADyr+0qAAACE1BMVEUAAAAAAAAAgID///8AVVUAgEAAgFUAbUkAgGAAdF3///////////////////////////////////////////////8DeVgDeFb///8DeFcDd1f///8DeVgFeFYFd1cFd1j///////////////////////////////////8Ed1cEeFcEeFf///8EeFcDeVcDeFcFeFcFeFf////////////////5/Pv6/Pz9/v7///////////////8EeFcFeFcFeFgFeVgGeVgGeVkHeVkHelkHeloIeloJeloJe1sKe1sLe1sLfFwMfFwMfV0NfV0OfV0Ofl4Pfl4Pf18Qfl8Qf18Rf18SgGATgGEUgWEVgWIWgWMXgmMYgmQZg2Qag2UahGYbhGcchWcdhWgehmgfhmkgh2khh2oiiGsjiGwlim0mim4ni24oi28qjHArjHEsjXItjXMvj3Mwj3QxkHUykHY0knc1kng4k3k5k3o7lXw8lX0/l35Al39CmYBDmYBGm4NHm4NJnYVKnYVMn4hNn4hRoYtSoYtVo41Wo41appBbppBeqJNfqJNiq5Zjq5ZnrZlorZlrsJxssJxwsqBxsqB2taR3taR9uah+uaiDvKuJv6+PwrOVxreXx7mcybyfy76jzcGq0car0sex1cq32c+42dC+3NTG4NnN5N7N5d7V6ePd7ejk8e3s9fLz+ff+/v7///+/UuqLAAAAPXRSTlMAAQICAwQGBwgLDg8QERwoKjU5QkRKTlNUVVhbXWJna5SWpKu1vL6/yM3Q1dba3N3h4unt7vj6+vr6+/z+xfS+2gAAAAFiS0dEsENkrsQAAAHwSURBVGje7ds7TsNAEAbgsbFEwUNCqei5AZyEDqFUNJQUvIqU0CTcggtwEBpKaIAqGGftvAgi2DMUSZV4ERGZ35K9biJtkU87+2d2ZTveLs1fHuldXe9ufrB5rige+YS9zgxaNBTkjEpdDZRhrkgDzVnmid6eWk2f80VqKIGtmIigyWn3wGLL2NZRK6v8YRNLk9X+k1VUyurx5AOXnEaEFpPMvo46WR39khzdrKJ3KyfqiYIWBS0KWhQn6ohc/jkyVgy4gKoyuqqMniNXY47o5DC6qszoDsDl7+RBBTpAwJKhOzmzE524HFG2l/Pd3c+/iryzFLDzhq6qEbBoInRyLFPUE+MI/etIGCx239EdIEnBYi9Ed7nkGywOQnQnj8dgcRiid6v4a0HR6/8PHIeL7o/+gzt1ONGJE5HQosDvkqHnKAXMMfXAc0wFXNVU0GIV7iGjQQq4GutIYJEJ3XMKeBqYoasKBslHg5V5joxOjqDXUYpIDl5ktIju5GiQfC5iHV3PUTjnUG12cENXpPX9mTHvVhE89Wn1YA1Y0xvjrxxuIlexnQT1rfnhKzVQDAW1nOF71eTkDaplNRtZ3tFVy+rJC3h/vIa/Tx71beuolFWObckpT1YHVlEpqxeP6LOcQZ8eLzvTCsL+/fQ6fQT6A8ieaw73RV12AAAAAElFTkSuQmCC";

export const Logo = ({ width = 120 }: { width?: number }) => (
  <div style={{ textAlign: "center", marginBottom: 24 }}>
    <Img src={LOGO_BASE64} alt="Eventify" width={width} />
  </div>
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

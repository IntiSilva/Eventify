'use client';

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { UserRole } from "@/generated/prisma";

interface UserAvatarProps {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  hasImage?: boolean | null;
  className?: string;
  fallbackClassName?: string;
  // --- Control props for border animation ---
  duration?: string;
  iterationCount?: number | 'infinite';
  role?: UserRole | null;
  variant?: 'creator' | 'attendee';
   /**
   * Controls how the outer ring is rendered:
   * - "animated" (default): spinning conic-gradient border.
   * - "static": static conic-gradient ring, no animation and smaller span.
   * - "none": no fancy border at all (just the avatar).
   */
  borderVariant?: 'animated' | 'static' | 'none';
   /**
   * Compact density is meant for dense lists (e.g. attendees list),
   * where we don't want heavy shadows / extra padding.
   */
  density?: 'normal' | 'compact';
}

type SpinVars = React.CSSProperties & {
  ['--duration-border-spin']?: string;
  ['--iteration-border-spin']?: string;
};

export default function UserAvatar({
  username,
  firstName,
  lastName,
  imageUrl,
  hasImage,
  className,
  fallbackClassName,
  duration,
  iterationCount = 3,
  role,
  variant = "creator",
  borderVariant = "animated",
  density = "normal",
}: UserAvatarProps) {
  // Determine fallback initials
  let initials = "?";
  if (firstName && lastName) {
    initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  } else if (firstName) {
    initials = firstName.charAt(0).toUpperCase();
  } else if (username) {
    initials = username.charAt(0).toUpperCase();
  }

  // Only try image if Clerk says the user actually has one
  const showImage = !!hasImage && !!imageUrl;

  // Build alt text
  const altText =
    (firstName && lastName && `${firstName} ${lastName}`) ||
    username ||
    "User avatar";

  // Dynamic animation style variables (inject only if provided so we don't override your CSS defaults)
  const animationStyles: SpinVars = {};
  if (duration) animationStyles["--duration-border-spin"] = duration;
  if (iterationCount !== undefined) {
    animationStyles["--iteration-border-spin"] = String(iterationCount);
  }

  // Define gradient color based on variant + role
  const gradientClass =
    variant === "creator"
      ? role === UserRole.admin
        // Creator (admin) → RED (rose-600)
        ? "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#e11d48_25%,transparent_50%)]"
        // Creator (organizer or others) → GREEN (emerald-600)
        : "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#059669_25%,transparent_50%)]"
      : role === UserRole.admin
        // Attendee (admin) → RED
        ? "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#e11d48_25%,transparent_50%)]"
        : role === UserRole.organizer
          // Attendee (organizer) → GREEN
          ? "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#059669_25%,transparent_50%)]"
          // Attendee (regular user) → WHITE
          : "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#ffffff_25%,transparent_50%)]";

  // Force remount when toggling between image and fallback to avoid stale visual state
  const avatarKey = showImage ? imageUrl! : "fallback";

  const showAnimatedBorder = borderVariant === "animated";
  const showStaticBorder = borderVariant === "static";

  return (
    // 1. Main container: defines the border thickness (via padding)
    <div
      className={cn(
        "relative rounded-full bg-transparent",
        density === "normal" && "p-[1.2px] shadow-md",
        density === "compact" && "p-[1px] shadow-none",
        borderVariant === "none" && "p-0 shadow-none overflow-visible",
        borderVariant !== "none" && "overflow-hidden",
      )}
    >
      {/* 2. Spinning gradient ring (animated variant) */}
      {showAnimatedBorder && (
        <span
          className={cn(
            "absolute inset-[-50%]",
            gradientClass,
            "animate-border-spin",
          )}
          style={animationStyles}
          aria-hidden
          role="presentation"
        />
      )}

      {/* 3. Static gradient ring (no animation, small span) */}
      {showStaticBorder && (
        <span
          className={cn(
            "absolute inset-[-30%]",
            gradientClass,
          )}
          aria-hidden
          role="presentation"
        />
      )}

      {/* 4. Avatar content placed above the gradient center */}
      <div className="relative">
        <Avatar
          key={avatarKey}
          className={cn(
            "flex items-center justify-center bg-black",
            className,
          )}
        >
          {showImage ? (
            <AvatarImage
              src={imageUrl!}
              alt={altText}
              className="object-cover"
            />
          ) : null}
          <AvatarFallback
            className={cn(
              "bg-transparent text-white text-xs font-semibold leading-none",
              fallbackClassName,
            )}
            delayMs={0}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
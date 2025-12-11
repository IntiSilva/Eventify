import type { Metadata } from 'next'
import { SignUp } from "@clerk/nextjs";
import AnimatedText from "@/components/AnimatedText/AnimatedText";
import LinesBackground from '@/components/AnimatedBackgrounds/LinesBackground';
import AuthAnimationWrapper from "@/components/AuthAnimationWrapper";

export const metadata: Metadata = {
  title: 'Sign up',
  alternates: { canonical: '/sign-up' },
}


export default function SignUpPage() {
  return (
     
        <div className="relative min-h-screen bg-black overflow-hidden">

      <LinesBackground/>

      {/* Wrapper animates childs with correct timing */}
      <AuthAnimationWrapper>
        {/* Child 1: Text */}
        <div className="max-w-md">
          <AnimatedText 
            title="Events, Simplified."
            subtitle="The easiest way to create, manage, and discover what's happening near you."
          />
        </div>

        {/* Child 2: Form */}
        <div className="w-full max-w-md">
          <SignUp
              routing="path"
              path="/sign-up"
              fallbackRedirectUrl="/onboarding"
              appearance={{
                elements: {
                  // Because we ask the username in our onboarding page we must hide the username input and label
                  // Even though we have it set off for the Sign Up component in Clerk's dashboard it still shows the username input and label
                  // Turning it on or off only changes if the label "optional" shows or not above the label.
                  // Also inline styles have to be passed instead of tailwind's so the label and dead spaces that are left because of the 
                  // missing input are also hidden, doing this in globals.css messes with the animations from AuthAnimationWrapper because the styles
                  // are not applied instantly as they are here.
                  formFieldRow__username: { display: 'none' },
                  formField__username: { display: 'none' },
                  formFieldLabelRow__username: { display: 'none' },
                  formFieldLabel__username: { display: 'none' },
                  formFieldInput__username: { display: 'none' },
                  formFieldAction__username: { display: 'none' },
                  formFieldErrorText__username: { display: 'none' },
                  formFieldWarningText__username: { display: 'none' },
                  formFieldSuccessText__username: { display: 'none' },
                  formFieldInfoText__username: { display: 'none' },

                  cardBox: '!shadow-[0px_0px_12px_rgba(16,185,129,0.7),_0px_0px_40px_rgba(16,185,129,0.3)] hover:!shadow-[0px_0px_35px_rgba(16,185,129,0.4),_0px_0px_60px_rgba(16,185,129,0.2)] transition-shadow duration-300 ease-in-out',
                  formButtonPrimary: 'my-clerk-button',
                  socialButtonsBlockButton__google: 'my-clerk-button',

                }
              }}
            />
        </div>
      </AuthAnimationWrapper>
    </div>
  );
}
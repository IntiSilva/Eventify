
import { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import AnimatedText from "@/components/AnimatedText/AnimatedText";
import LinesBackground from "@/components/AnimatedBackgrounds/LinesBackground";
import AuthAnimationWrapper from "@/components/AuthAnimationWrapper";

export const metadata: Metadata = {
  title: 'Sign in',
  alternates: { canonical: '/sign-in' },
}

export default function SignInPage() {
  return (
     
        <div className="relative min-h-screen bg-black overflow-hidden">
      <LinesBackground/>

      {/* Wrapper animates childs with correct timing */}
      <AuthAnimationWrapper>
        {/* Child 1: Text */}
        <div className="max-w-md">
          <AnimatedText 
            title="Welcome Back"
            subtitle="Access your dashboard, manage your events, and connect with your community."
            
          />
        </div>

        {/* Child 2: Form */}
        <div className="w-full max-w-md">
          <SignIn
            routing="path"
            path="/sign-in"
            appearance={{
              elements: {
                cardBox: '!shadow-[0px_0px_12px_rgba(16,185,129,0.7),_0px_0px_40px_rgba(16,185,129,0.3)] hover:!shadow-[0px_0px_35px_rgba(16,185,129,0.4),_0px_0px_60px_rgba(16,185,129,0.2)] transition-shadow duration-300 ease-in-out',
                formButtonPrimary: 'my-clerk-button',
                socialButtonsBlockButton__google: 'my-clerk-button'
              }
            }}
          />
        </div>
      </AuthAnimationWrapper>
    </div>
  );
}
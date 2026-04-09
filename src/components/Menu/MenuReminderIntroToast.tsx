import Lottie from 'lottie-react';
import { Button } from '@/components/ui/button';
import { LottieDoubleTapAnimatedIcon } from '@/lib/icons';

type MenuReminderIntroToastProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export default function MenuReminderIntroToast({
  onConfirm,
  onCancel,
}: MenuReminderIntroToastProps) {
  return (
    <div className="bg-black p-4 rounded-lg shadow-xl text-white w-full max-w-sm flex flex-col items-center text-center border border-zinc-700 font-sans">
      <p className="text-lg font-heading font-semibold">Would you like to be reminded?</p>
      <Lottie
        animationData={LottieDoubleTapAnimatedIcon}
        loop
        autoplay
        style={{ width: 60, height: 60, marginTop: '-10px' }}
      />
      <p className="text-xs text-zinc-400 -mt-2">(Double-Tap to interact)</p>
      <div className="flex space-x-3 w-full pt-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full flex-1 text-white hover:text-white focus:text-white bg-black border border-zinc-800 hover:bg-emerald-950/50 hover:border-emerald-800 focus:bg-emerald-950/50 focus:border-emerald-800 cursor-pointer transition-colors duration-200"
          onClick={onConfirm}
        >
          Yes, please
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full flex-1 hover:bg-rose-950/50 hover:border hover:border-rose-800 focus:bg-rose-950/50 focus:border focus:border-rose-800 text-white hover:text-white focus:text-white cursor-pointer transition-colors duration-200"
          onClick={onCancel}
        >
          No, thanks
        </Button>
      </div>
    </div>
  );
}

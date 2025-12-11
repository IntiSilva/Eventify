'use client';
import { Toaster } from 'sonner';
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon';
import { LoadingCirclesAnimatedIcon, CheckAnimatedIcon, ErrorAnimatedIcon } from '@/lib/icons';
import { useMediaQuery } from '@/lib/hooks';

export default function GlobalToaster() {
  const isDesktop = useMediaQuery('(min-width: 768px)');


  return (
    <Toaster
      theme="dark"
      closeButton
      position={isDesktop ? 'bottom-right' : 'top-center'}
      icons={{
        loading: <AnimatedIcon icon={LoadingCirclesAnimatedIcon} size={24} state="loop" />,
        success: <AnimatedIcon icon={CheckAnimatedIcon} size={24} state="in" persistAfterIn />,
        error:   <AnimatedIcon icon={ErrorAnimatedIcon} size={24} state="in" persistAfterIn colors={{primary: "#e11d48"}} />, //Color is rose-600
      }}
    />
  );
}

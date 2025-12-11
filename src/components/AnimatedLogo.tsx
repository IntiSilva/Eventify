'use client';

import React from 'react';
import { motion, type Variants } from 'motion/react';

type MotionSvgProps = React.ComponentPropsWithoutRef<typeof motion.svg>;

interface AnimatedLogoProps extends MotionSvgProps {
  /** Base duration for the stroke animation */
  animationDuration?: number;
  /** Delay between stroke steps */
  stepDelay?: number;
  /** Logo colors */
  colors?: {
    primary: string;
    secondary: string;
  };
}

const logoPaths = [

  { type: 'path', data: 'M.5.5v120h16V.5Z', colorKey: 'secondary', order: 1 },
  { type: 'path', data: 'M.5,108.5V15.12l4,2v87.13Z', colorKey: 'primary', order: 1 },

  { type: 'path', data: 'M16.24.5h93.4l-2.08,4H16.24Z', colorKey: 'secondary', order: 0 },
  { type: 'path', data: 'M16.24,6.5H106.5l-2,4H16.24Z', colorKey: 'secondary', order: 0 },
  { type: 'path', data: 'M16.24,12.5h87.42l-1.94,4H16.24Z', colorKey: 'secondary', order: 0 },

  { type: 'path', data: 'M16.24,104.5h93.4l-2.08,4H16.24Z', colorKey: 'secondary', order: 2 },
  { type: 'path', data: 'M16.24,110.5H106.5l-2,4H16.24Z', colorKey: 'secondary', order: 2 },
  { type: 'path', data: 'M16.24,116.5h87.42l-1.94,4H16.24Z', colorKey: 'secondary', order: 2 },

  { type: 'polygon', data: '81.36 65.75 17.5 65.75 17.5 49.75 88.83 49.75 81.36 65.75', colorKey: 'primary', order: 1 },
];

const AnimatedLogo: React.FC<AnimatedLogoProps> = ({
  className,
  animationDuration = 1.0,
  stepDelay = 0.35,
  colors = { primary: '#047857', secondary: '#FFFFFF' },
  ...svgProps
}) => {
  const maxOrder = Math.max(...logoPaths.map((path) => path.order));
  const fillDelay = maxOrder * stepDelay + animationDuration * 0.75;

  const drawVariants: Variants = {
    hidden: {
      pathLength: 0,
      opacity: 0,
      fillOpacity: 0,
    },
    visible: (order: number) => {
      const strokeDelay = stepDelay * order;
      return {
        pathLength: 1,
        opacity: 1,
        fillOpacity: 1,
        transition: {
          pathLength: {
            delay: strokeDelay,
            type: 'spring',
            duration: animationDuration * 1.5,
            bounce: 0,
          },
          opacity: { delay: strokeDelay, duration: 0.01 },
          fillOpacity: { delay: fillDelay, duration: animationDuration * 0.75 },
        },
      };
    },
  };

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 110.46 121"
      className={className}
      initial="hidden"
      animate="visible"
      {...svgProps}
    >
      {logoPaths
        .sort((a, b) => a.order - b.order)
        .map((path, i) => {
          const strokeColor = path.colorKey === 'primary' ? colors.primary : colors.secondary;
          const MotionComponent = path.type === 'path' ? motion.path : motion.polygon;
          const pathProps = path.type === 'path' ? { d: path.data } : { points: path.data };

          return (
            <MotionComponent
              key={i}
              {...pathProps}
              stroke={strokeColor}
              fill={strokeColor}
              strokeWidth={1}
              strokeMiterlimit={10}
              variants={drawVariants}
              custom={path.order}
            />
          );
        })}
    </motion.svg>
  );
};

export default AnimatedLogo;

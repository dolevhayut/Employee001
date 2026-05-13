import React from "react";
import { Composition } from "remotion";
import { Employee001SocialDemo } from "./SocialDemo";
import { Employee001DemoV2 } from "./SocialDemoV2";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Employee001SocialDemo"
        component={Employee001SocialDemo}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Employee001DemoV2"
        component={Employee001DemoV2}
        durationInFrames={960}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

import type { ReactNode } from "react";
import ProfileSelector from "./ProfileSelector";

interface Props {
  children: ReactNode;
}

export default function ProfileGate({ children }: Props) {
  const active = localStorage.getItem("active_profile");
  if (!active) return <ProfileSelector />;
  return <>{children}</>;
}

import Image from "next/image";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Image
      src="/logo.svg"
      alt="Employee001"
      width={size}
      height={size}
      priority
      className="brand-logo"
      style={{ display: "block", flexShrink: 0 }}
    />
  );
}

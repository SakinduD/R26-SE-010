export default function AuthDivider({ text = 'or' }) {
  return (
    <div className="relative my-5">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-[11px] uppercase tracking-widest">
        <span className="bg-white dark:bg-card px-3 text-muted-foreground">
          {text}
        </span>
      </div>
    </div>
  );
}

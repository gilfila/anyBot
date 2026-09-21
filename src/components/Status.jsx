export function Status({ status }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {status.replaceAll("-", " ")}
    </span>
  );
}

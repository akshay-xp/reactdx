import ClientItem from './ClientItem';

export default function ServerList() {
  return (
    <ul>
      {['a', 'b', 'c'].map((label) => (
        <ClientItem key={label} label={label} />
      ))}
    </ul>
  );
}

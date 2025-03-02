// app/components/
export default function Results({ recommendations }) {
  return (
    <div className="border rounded-md p-4 bg-gray-50">
      <h2 className="text-xl font-semibold mb-4">Tool Recommendations</h2>
      <div
        className="prose max-w-none"
        dangerouslySetInnerHTML={{ __html: recommendations }}
      />
    </div>
  );
}

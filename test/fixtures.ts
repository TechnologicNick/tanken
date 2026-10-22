export function rawStation(id: string, lng: number, price = 1.839) {
  return {
    id,
    title: id.includes("|") ? "CIRCLE K" : "Tango Test",
    coordinates: { latitude: 52.08, longitude: lng },
    address: {
      streetAddress: "Teststraat 1",
      postalCode: "1234AB",
      city: "Teststad",
      country: id.includes("|") ? "België" : "Nederland",
      iso3CountryCode: id.includes("|") ? "BEL" : "NLD",
    },
    prices: [
      {
        fuelType: "EURO95",
        fuelName: "Euro 95 (E10)",
        value: price,
        currency: "EUR",
        priceTier: { value: 1 },
      },
      {
        fuelType: "DIESEL",
        fuelName: "Diesel (B7)",
        value: 1.729,
        currency: "EUR",
        priceTier: { value: 2 },
      },
    ],
    openingHours: [{ dayOfWeek: ["MONDAY"], opens: "00:00", closes: "24:00" }],
  };
}

import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import { createProductsWorkflow } from "@medusajs/medusa/core-flows";

export default async function seedAdditionalProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);

  logger.info("Seeding additional product data...");

  // Get the default sales channel
  const defaultSalesChannel = await salesChannelModuleService.listSalesChannels(
    {
      name: "Default Sales Channel",
    }
  );

  if (!defaultSalesChannel.length) {
    logger.error(
      "Default Sales Channel not found. Please run the main seed script first."
    );
    return;
  }

  // Get the default shipping profile
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });

  if (!shippingProfiles.length) {
    logger.error(
      "Default Shipping Profile not found. Please run the main seed script first."
    );
    return;
  }

  const shippingProfile = shippingProfiles[0];

  // Get existing categories
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  });

  const categoryMap = categories.reduce((acc: any, cat: any) => {
    acc[cat.name] = cat.id;
    return acc;
  }, {});

  // Check if required categories exist
  const requiredCategories = ["Shirts", "Sweatshirts", "Pants", "Merch"];
  for (const categoryName of requiredCategories) {
    if (!categoryMap[categoryName]) {
      logger.error(
        `Category "${categoryName}" not found. Please run the main seed script first.`
      );
      return;
    }
  }

  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Medusa Hoodie",
          category_ids: [categoryMap["Sweatshirts"]],
          description:
            "Stay warm and comfortable with our premium cotton hoodie. Perfect for casual wear or layering.",
          handle: "hoodie",
          weight: 600,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/hoodie-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L", "XL"],
            },
            {
              title: "Color",
              values: ["Navy", "Gray"],
            },
          ],
          variants: [
            {
              title: "S / Navy",
              sku: "HOODIE-S-NAVY",
              options: {
                Size: "S",
                Color: "Navy",
              },
              prices: [
                {
                  amount: 45,
                  currency_code: "eur",
                },
                {
                  amount: 55,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / Navy",
              sku: "HOODIE-M-NAVY",
              options: {
                Size: "M",
                Color: "Navy",
              },
              prices: [
                {
                  amount: 45,
                  currency_code: "eur",
                },
                {
                  amount: 55,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Gray",
              sku: "HOODIE-L-GRAY",
              options: {
                Size: "L",
                Color: "Gray",
              },
              prices: [
                {
                  amount: 45,
                  currency_code: "eur",
                },
                {
                  amount: 55,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL / Gray",
              sku: "HOODIE-XL-GRAY",
              options: {
                Size: "XL",
                Color: "Gray",
              },
              prices: [
                {
                  amount: 45,
                  currency_code: "eur",
                },
                {
                  amount: 55,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Cap",
          category_ids: [categoryMap["Merch"]],
          description:
            "Complete your look with our stylish cap featuring the Medusa logo.",
          handle: "cap",
          weight: 150,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/cap-front.png",
            },
          ],
          options: [
            {
              title: "Color",
              values: ["Black", "White", "Red"],
            },
          ],
          variants: [
            {
              title: "Black",
              sku: "CAP-BLACK",
              options: {
                Color: "Black",
              },
              prices: [
                {
                  amount: 20,
                  currency_code: "eur",
                },
                {
                  amount: 25,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "White",
              sku: "CAP-WHITE",
              options: {
                Color: "White",
              },
              prices: [
                {
                  amount: 20,
                  currency_code: "eur",
                },
                {
                  amount: 25,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "Red",
              sku: "CAP-RED",
              options: {
                Color: "Red",
              },
              prices: [
                {
                  amount: 22,
                  currency_code: "eur",
                },
                {
                  amount: 27,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Tank Top",
          category_ids: [categoryMap["Shirts"]],
          description:
            "Stay cool in our lightweight cotton tank top, perfect for summer days.",
          handle: "tank-top",
          weight: 200,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tank-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L", "XL"],
            },
            {
              title: "Color",
              values: ["White", "Gray"],
            },
          ],
          variants: [
            {
              title: "S / White",
              sku: "TANK-S-WHITE",
              options: {
                Size: "S",
                Color: "White",
              },
              prices: [
                {
                  amount: 15,
                  currency_code: "eur",
                },
                {
                  amount: 18,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / White",
              sku: "TANK-M-WHITE",
              options: {
                Size: "M",
                Color: "White",
              },
              prices: [
                {
                  amount: 15,
                  currency_code: "eur",
                },
                {
                  amount: 18,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Gray",
              sku: "TANK-L-GRAY",
              options: {
                Size: "L",
                Color: "Gray",
              },
              prices: [
                {
                  amount: 15,
                  currency_code: "eur",
                },
                {
                  amount: 18,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL / Gray",
              sku: "TANK-XL-GRAY",
              options: {
                Size: "XL",
                Color: "Gray",
              },
              prices: [
                {
                  amount: 15,
                  currency_code: "eur",
                },
                {
                  amount: 18,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Jeans",
          category_ids: [categoryMap["Pants"]],
          description:
            "Classic denim jeans with a modern fit and premium quality.",
          handle: "jeans",
          weight: 700,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/jeans-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["28", "30", "32", "34", "36"],
            },
            {
              title: "Color",
              values: ["Blue", "Black"],
            },
          ],
          variants: [
            {
              title: "28 / Blue",
              sku: "JEANS-28-BLUE",
              options: {
                Size: "28",
                Color: "Blue",
              },
              prices: [
                {
                  amount: 80,
                  currency_code: "eur",
                },
                {
                  amount: 95,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "30 / Blue",
              sku: "JEANS-30-BLUE",
              options: {
                Size: "30",
                Color: "Blue",
              },
              prices: [
                {
                  amount: 80,
                  currency_code: "eur",
                },
                {
                  amount: 95,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "32 / Black",
              sku: "JEANS-32-BLACK",
              options: {
                Size: "32",
                Color: "Black",
              },
              prices: [
                {
                  amount: 85,
                  currency_code: "eur",
                },
                {
                  amount: 100,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "34 / Black",
              sku: "JEANS-34-BLACK",
              options: {
                Size: "34",
                Color: "Black",
              },
              prices: [
                {
                  amount: 85,
                  currency_code: "eur",
                },
                {
                  amount: 100,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Polo Shirt",
          category_ids: [categoryMap["Shirts"]],
          description:
            "Elegant polo shirt perfect for both casual and semi-formal occasions.",
          handle: "polo-shirt",
          weight: 350,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/polo-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L", "XL"],
            },
            {
              title: "Color",
              values: ["Navy", "White", "Green"],
            },
          ],
          variants: [
            {
              title: "S / Navy",
              sku: "POLO-S-NAVY",
              options: {
                Size: "S",
                Color: "Navy",
              },
              prices: [
                {
                  amount: 35,
                  currency_code: "eur",
                },
                {
                  amount: 42,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / White",
              sku: "POLO-M-WHITE",
              options: {
                Size: "M",
                Color: "White",
              },
              prices: [
                {
                  amount: 35,
                  currency_code: "eur",
                },
                {
                  amount: 42,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Green",
              sku: "POLO-L-GREEN",
              options: {
                Size: "L",
                Color: "Green",
              },
              prices: [
                {
                  amount: 35,
                  currency_code: "eur",
                },
                {
                  amount: 42,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Backpack",
          category_ids: [categoryMap["Merch"]],
          description:
            "Durable and stylish backpack perfect for everyday use or travel.",
          handle: "backpack",
          weight: 800,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/backpack-front.png",
            },
          ],
          options: [
            {
              title: "Color",
              values: ["Black", "Gray", "Navy"],
            },
          ],
          variants: [
            {
              title: "Black",
              sku: "BACKPACK-BLACK",
              options: {
                Color: "Black",
              },
              prices: [
                {
                  amount: 75,
                  currency_code: "eur",
                },
                {
                  amount: 90,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "Gray",
              sku: "BACKPACK-GRAY",
              options: {
                Color: "Gray",
              },
              prices: [
                {
                  amount: 75,
                  currency_code: "eur",
                },
                {
                  amount: 90,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "Navy",
              sku: "BACKPACK-NAVY",
              options: {
                Color: "Navy",
              },
              prices: [
                {
                  amount: 78,
                  currency_code: "eur",
                },
                {
                  amount: 93,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Socks",
          category_ids: [categoryMap["Merch"]],
          description:
            "Comfortable cotton socks with the Medusa logo. Available in packs.",
          handle: "socks",
          weight: 100,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/socks-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L"],
            },
            {
              title: "Color",
              values: ["Black", "White", "Gray"],
            },
          ],
          variants: [
            {
              title: "S / Black",
              sku: "SOCKS-S-BLACK",
              options: {
                Size: "S",
                Color: "Black",
              },
              prices: [
                {
                  amount: 8,
                  currency_code: "eur",
                },
                {
                  amount: 10,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / White",
              sku: "SOCKS-M-WHITE",
              options: {
                Size: "M",
                Color: "White",
              },
              prices: [
                {
                  amount: 8,
                  currency_code: "eur",
                },
                {
                  amount: 10,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Gray",
              sku: "SOCKS-L-GRAY",
              options: {
                Size: "L",
                Color: "Gray",
              },
              prices: [
                {
                  amount: 8,
                  currency_code: "eur",
                },
                {
                  amount: 10,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Jacket",
          category_ids: [categoryMap["Sweatshirts"]],
          description:
            "Stylish jacket perfect for transitional weather. Water-resistant and comfortable.",
          handle: "jacket",
          weight: 900,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/jacket-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L", "XL"],
            },
            {
              title: "Color",
              values: ["Black", "Navy"],
            },
          ],
          variants: [
            {
              title: "S / Black",
              sku: "JACKET-S-BLACK",
              options: {
                Size: "S",
                Color: "Black",
              },
              prices: [
                {
                  amount: 120,
                  currency_code: "eur",
                },
                {
                  amount: 145,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / Black",
              sku: "JACKET-M-BLACK",
              options: {
                Size: "M",
                Color: "Black",
              },
              prices: [
                {
                  amount: 120,
                  currency_code: "eur",
                },
                {
                  amount: 145,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Navy",
              sku: "JACKET-L-NAVY",
              options: {
                Size: "L",
                Color: "Navy",
              },
              prices: [
                {
                  amount: 125,
                  currency_code: "eur",
                },
                {
                  amount: 150,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Medusa Button-up Shirt",
          category_ids: [categoryMap["Shirts"]],
          description:
            "Professional button-up shirt made from premium cotton. Perfect for business or formal occasions.",
          handle: "button-shirt",
          weight: 400,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/button-shirt-front.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L", "XL"],
            },
            {
              title: "Color",
              values: ["White", "Blue", "Black"],
            },
          ],
          variants: [
            {
              title: "S / White",
              sku: "BUTTON-S-WHITE",
              options: {
                Size: "S",
                Color: "White",
              },
              prices: [
                {
                  amount: 55,
                  currency_code: "eur",
                },
                {
                  amount: 65,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / Blue",
              sku: "BUTTON-M-BLUE",
              options: {
                Size: "M",
                Color: "Blue",
              },
              prices: [
                {
                  amount: 55,
                  currency_code: "eur",
                },
                {
                  amount: 65,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Black",
              sku: "BUTTON-L-BLACK",
              options: {
                Size: "L",
                Color: "Black",
              },
              prices: [
                {
                  amount: 58,
                  currency_code: "eur",
                },
                {
                  amount: 68,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
      ],
    },
  });

  logger.info("Finished seeding additional product data!");
  logger.info("Added 10 new products:");
  logger.info("- Medusa Hoodie (Sweatshirts)");
  logger.info("- Medusa Cap (Merch)");
  logger.info("- Medusa Tank Top (Shirts)");
  logger.info("- Medusa Jeans (Pants)");
  logger.info("- Medusa Polo Shirt (Shirts)");
  logger.info("- Medusa Backpack (Merch)");
  logger.info("- Medusa Socks (Merch)");
  logger.info("- Medusa Jacket (Sweatshirts)");
  logger.info("- Medusa Button-up Shirt (Shirts)");
}

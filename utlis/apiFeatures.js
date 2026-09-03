// Chainable helper: new ApiFeatures(Model.find(), req.query).filter().search().sort().select().paginate()
class ApiFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  // Full-text search (products have text index on name/description/tags)
  search() {
    if (this.queryString.search) {
      this.query = this.query.find({ $text: { $search: this.queryString.search } });
    }
    return this;
  }

  // Filter: ?price[gte]=100&price[lte]=200&brand=xxx&gender=men
  filter() {
    const exclude = ["search", "sort", "page", "limit", "fields"];
    const q = { ...this.queryString };
    exclude.forEach((k) => delete q[k]);

    // convert gte/gt/lte/lt to $gte/$gt/$lte/$lt
    const str = JSON.stringify(q).replace(
      /\b(gte|gt|lte|lt)\b/g,
      (m) => `$${m}`,
    );
    this.query = this.query.find(JSON.parse(str));
    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(",").join(" ");
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort("-createdAt");
    }
    return this;
  }

  select() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(",").join(" ");
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select("-__v");
    }
    return this;
  }

  paginate() {
    const page = Math.max(1, Number(this.queryString.page) || 1);
    const limit = Math.min(100, Number(this.queryString.limit) || 12);
    const skip = (page - 1) * limit;
    this.query = this.query.skip(skip).limit(limit);
    this.page = page;
    this.limit = limit;
    return this;
  }
}

export default ApiFeatures;
